import type { Room } from './room';

export interface RoomStore {
  create(id: string, senderTokenHash: string, now: number, expiresAt: number): Room;
  get(id: string): Room | undefined;
  delete(id: string): void;
  sweep(now: number): void;
  count(): number;
}
