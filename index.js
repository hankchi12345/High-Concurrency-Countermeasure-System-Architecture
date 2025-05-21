require('dotenv').config();

const { Pool } = require('pg');
const express = require('express');
const Redis = require('redis');

// --- Prometheus 相關引入 ---
const client = require('prom-client');
const { Pushgateway, Registry, Counter } = client;

// 創建一個新的註冊表
const register = new Registry();

// 創建計數器：總下單次數
const purchaseCounter = new Counter({
  name: 'seckill_purchases_total',
  help: '總下單次數',
});
register.registerMetric(purchaseCounter); // 將計數器註冊到註冊表

// 設置 Pushgateway
// 請確保你的 Pushgateway 服務運行在 http://localhost:9091 或正確的 IP:Port
const gateway = new Pushgateway('http://172.17.0.1:9091', [], register); // 注意這裡的 IP
// ----------------------------

const pg = new Pool({
  host: process.env.PG_HOST,
  port: process.env.PG_PORT,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
});

const app = express();
const PORT = process.env.PORT || 3000;

const redisClient = Redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redisClient.connect().catch(console.error);

async function initializeRedisStock() {
  try {
    const result = await pg.query('SELECT id, name, stock FROM items'); // 為了日誌更清楚，也選取 name
    for (const item of result.rows) {
      const key = `item_stock_${item.id}`;
      // 使用 SETNX 來確保只有在鍵不存在時才設定，避免重複啟動導致庫存被重設
      const setnxResult = await redisClient.set(key, item.stock, { NX: true });
      if (setnxResult === null) {
        console.log(`Redis stock for item ${item.name} (ID: ${item.id}) already exists, skipping initialization.`);
      } else {
        console.log(`Initialized Redis stock for item ${item.name} (ID: ${item.id}): ${item.stock}`);
      }
    }
  } catch (error) {
    console.error('Error initializing Redis stock from PostgreSQL:', error);
    process.exit(1);
  }
}

async function rateLimiter(req, res, next) {
  const ip = req.ip;
  const now = Math.floor(Date.now() / 1000);
  const key = `rl:${ip}:${now}`;

  const count = await redisClient.incr(key);
  if (count === 1) {
    await redisClient.expire(key, 1);
  }

  if (count > 3) {
    return res.status(429).send('Too Many Requests');
  }

  next();
}

app.get('/items', async (req, res) => {
  try {
    const result = await pg.query('SELECT * FROM items');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching items from PostgreSQL:', error);
    res.status(500).send('Failed to fetch items');
  }
});

app.post('/purchase/:id', rateLimiter, async (req, res) => {
  const itemId = parseInt(req.params.id);
  const redisStockKey = `item_stock_${itemId}`;

  try {
    const remaining = await redisClient.decr(redisStockKey);

    if (remaining < 0) {
      await redisClient.incr(redisStockKey); // 補回來
      return res.status(400).send('Sold out!');
    }

    // --- Prometheus 計數器更新 ---
    purchaseCounter.inc(); // 每次購買成功加一
    // 異步推送指標到 Pushgateway，不阻塞主流程
    gateway.pushAdd({ jobName: 'seckill_api' }).catch(err => {
        console.error('Failed to push metrics to Pushgateway:', err);
    });
    // ----------------------------

    await pg.query('BEGIN');
    await pg.query('UPDATE items SET stock = stock - 1 WHERE id = $1 AND stock > 0', [itemId]);
    await pg.query('INSERT INTO orders (item_id) VALUES ($1)', [itemId]);
    await pg.query('COMMIT');

    res.send(`Success! Remaining: ${remaining}`);

  } catch (error) {
    console.error('Purchase error:', error);
    try {
      await redisClient.incr(redisStockKey);
      await pg.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Error during rollback:', rollbackError);
    }
    res.status(500).send('Purchase failed, please try again.');
  }
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Seckill API running on http://0.0.0.0:${PORT}`);
  await initializeRedisStock();
});
