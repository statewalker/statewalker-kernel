import { del, get, set } from "idb-keyval";

const HANDLE_KEY = "chat-mini:workspace-handle";

export async function getStoredHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  return await get<FileSystemDirectoryHandle | undefined>(HANDLE_KEY);
}

export async function setStoredHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await set(HANDLE_KEY, handle);
}

export async function clearStoredHandle(): Promise<void> {
  await del(HANDLE_KEY);
}
