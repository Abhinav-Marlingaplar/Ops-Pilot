const amqp = require('amqplib');

let channel;

async function connectQueue() {
  try {
    const connection = await amqp.connect(process.env.RABBITMQ_URL);
    channel = await connection.createChannel();
    await channel.assertQueue('build_jobs', { durable: true });
    console.log('RabbitMQ connected, queue ready');
  } catch (err) {
    console.error('RabbitMQ connection failed:', err.message);
    process.exit(1);
  }
}

function getChannel() {
  return channel;
}

module.exports = { connectQueue, getChannel };