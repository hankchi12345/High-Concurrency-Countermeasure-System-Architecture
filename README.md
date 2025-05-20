##  High-Concurrency-Countermeasure-System-Architecture
#   高並發對策系統架構

##  系統架構概述

###  使用者請求流程

* **使用者：** 使用瀏覽器發起請求。
    * **前端頁面：** 使用者在瀏覽器中存取的靜態頁面。
    * **Nginx (API 閘道)：** 接收使用者請求，進行路由和轉發。
        * **Node.js 後端 API (Express)：** 處理業務邏輯。
            * **Redis：** 用於限流和快取。
            * **PostgreSQL：** 用於儲存訂單資料。

---


