require('dotenv').config();
const { startConsumer } = require('./consumer');

console.log('[worker] Starting CI/CD worker...');
console.log(`[worker] ID:       ${process.env.WORKER_ID}`);
console.log(`[worker] RabbitMQ: ${process.env.RABBITMQ_URL}`);
console.log(`[worker] Backend:  ${process.env.BACKEND_URL}`);

startConsumer().catch((err) => {
  console.error('[worker] Fatal error:', err.message);
  process.exit(1);
});