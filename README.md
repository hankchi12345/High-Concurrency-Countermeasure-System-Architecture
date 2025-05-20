# High-Concurrency-Countermeasure-System-Architecture
使用者
  │
  ▼
前端頁面（用瀏覽器開啟）
  │
  ▼
Nginx（API Gateway）
  │
  ▼
Node.js 後端 API（Express）
  ├─► Redis（檢查是否限流）
  └─► PostgreSQL（寫入訂單）

High-Concurrency Countermeasure System Architecture
