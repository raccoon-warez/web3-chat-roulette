import { createClient, RedisClientType } from 'redis';

// Create Redis client
const redisClient: RedisClientType = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

// Connect to Redis
redisClient.on('error', (err) => {
  console.error('Redis Client Error', err);
});

// Initialize Redis connection
const initializeRedis = async () => {
  try {
    await redisClient.connect();
    console.log('Connected to Redis');
  } catch (error) {
    console.error('Error connecting to Redis:', error);
  }
};

// Export Redis client and initialization function
export { redisClient, initializeRedis };
