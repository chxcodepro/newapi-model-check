// 数据库结构同步脚本
// 读取 prisma/init.postgresql.sql 并执行，幂等安全可重复运行

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("ERROR: DATABASE_URL 环境变量未设置");
  process.exit(1);
}

const sqlPath = path.join(__dirname, "..", "prisma", "init.postgresql.sql");
if (!fs.existsSync(sqlPath)) {
  console.error(`ERROR: SQL 文件不存在: ${sqlPath}`);
  process.exit(1);
}

const sql = fs.readFileSync(sqlPath, "utf-8");

async function main() {
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    console.log("已连接数据库，开始同步表结构...");
    await client.query(sql);
    console.log("数据库结构同步完成");
  } catch (err) {
    console.error("同步失败:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
