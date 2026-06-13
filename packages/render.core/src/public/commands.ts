import { Command, passthrough } from "@statewalker/shared-commands";
import type { Spec, SpecPatch } from "./types.js";

export interface CreateSpecPayload {
  catalogId: string;
  spec: Spec;
  meta?: Record<string, unknown>;
}

export interface CreateSpecResult {
  specId: string;
}

export const CreateSpecCommand = Command.silent("spec:create")
  .input(passthrough<CreateSpecPayload>())
  .output(passthrough<CreateSpecResult>())
  .build();

export interface PatchSpecPayload {
  specId: string;
  patch: SpecPatch;
}

export const PatchSpecCommand = Command.silent("spec:patch")
  .input(passthrough<PatchSpecPayload>())
  .output(passthrough<void>())
  .build();
