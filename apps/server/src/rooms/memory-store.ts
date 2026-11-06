import type { Room } from './room.js';
import type { RoomStore } from './room-store.js';

export class MemoryRoomStore implements RoomStore {
  private readonly rooms = new Map<string, Room>();

  create(id: string, senderTokenHash: string, now: number, expiresAt: number): Room {
    const room: Room = {
      id,
      senderTokenHash,
      state: 'WAITING_SENDER',
      createdAt: now,
      expiresAt,
    };
    this.rooms.set(id, room);
    return room;
  }

  get(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  delete(id: string): void {
    this.rooms.delete(id);
  }

  sweep(now: number): void {
    for (const [id, room] of this.rooms.entries()) {
      if (room.expiresAt <= now || room.state === 'CLOSED') {
        if (room.sender && room.sender.readyState === 1) {
          try {
            room.sender.close();
          } catch {
            // ignore
          }
        }
        if (room.receiver && room.receiver.readyState === 1) {
          try {
            room.receiver.close();
          } catch {
            // ignore
          }
        }
        this.rooms.delete(id);
      }
    }
  }

  count(): number {
    return this.rooms.size;
  }
}
