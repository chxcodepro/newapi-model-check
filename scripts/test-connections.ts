import "dotenv/config";
import prisma from "../src/lib/prisma";
import redis from "../src/lib/redis";

async function testConnections() {
  console.log("🔍 Testing Database & Redis Connections...\n");

  try {
    // Test Database Connection
    console.log("📊 Testing Database Connection...");
    await prisma.$connect();
    const channelCount = await prisma.channel.count();
    console.log("✅ Database connected successfully");
    console.log(`   Found ${channelCount} channels in database\n`);

    // Test Redis Connection
    console.log("🔴 Testing Redis Connection...");
    await redis.ping();
    console.log("✅ Redis connected successfully");

    // Test Redis operations
    await redis.set("test_key", "test_value", "EX", 10);
    const value = await redis.get("test_key");
    console.log(`   Redis set/get test: ${value === "test_value" ? "PASS" : "FAIL"}\n`);

    console.log("🎉 All connections successful!");
  } catch (error) {
    console.error("❌ Connection test failed:", error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
    await redis.quit();
  }
}

testConnections();
