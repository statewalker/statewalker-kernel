import type { FileInfo } from "@statewalker/webrun-files";
import { ViewModel } from "./view-model.js";

/**
 * Reactive state for a panel-internal search query. The renderer owns
 * the search panel UI; the search controller drives async iteration
 * over `FilesApi` and pushes results in via `addResult`.
 */
export class SearchModel extends ViewModel {
  pattern = "";
  searchIn: "names" | "content" = "names";
  caseSensitive = false;
  results: FileInfo[] = [];
  searching = false;

  private _settled = false;
  private _cancelled = false;

  setPattern(pattern: string): void {
    this.pattern = pattern;
    this.notify();
  }

  setSearchIn(value: "names" | "content"): void {
    this.searchIn = value;
    this.notify();
  }

  setCaseSensitive(on: boolean): void {
    this.caseSensitive = on;
    this.notify();
  }

  /** Begin a new search — clears prior results and flips `searching`. */
  start(): void {
    this.searching = true;
    this.results = [];
    this._settled = false;
    this._cancelled = false;
    this.notify();
  }

  cancel(): void {
    this._cancelled = true;
    this.searching = false;
    this._settled = true;
    this.notify();
  }

  isSettled(): boolean {
    return this._settled;
  }

  get cancelled(): boolean {
    return this._cancelled;
  }

  addResult(entry: FileInfo): void {
    this.results.push(entry);
    this.notify();
  }

  markDone(): void {
    this.searching = false;
    this._settled = true;
    this.notify();
  }
}
