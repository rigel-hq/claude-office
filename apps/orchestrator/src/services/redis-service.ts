import Redis from 'ioredis';

let publisher: Redis | null = null;
let subscriber: Redis | null = null;

export function getRedisPublisher(url: string): Redis {
  if (!publisher) {
    publisher = new Redis(url);
  }
  return publisher;
}

export function getRedisSubscriber(url: string): Redis {
  if (!subscriber) {
    subscriber = new Redis(url);
  }
  return subscriber;
}

export async function disconnectRedis(): Promise<void> {
  if (publisher) {
    await publisher.quit();
    publisher = null;
  }
  if (subscriber) {
    await subscriber.quit();
    subscriber = null;
  }
}
