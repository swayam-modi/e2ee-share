import { MemoryRoomStore } from './memory-store';
import type { RoomStore } from './types';

declare global {
  var __roomStore: RoomStore | undefined; // required: global var declaration in TypeScript
}

if (!global.__roomStore) {
  global.__roomStore = new MemoryRoomStore();
}

export const roomStore: RoomStore = global.__roomStore;
