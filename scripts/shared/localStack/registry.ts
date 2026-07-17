import {
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { isRpcReady } from "../net/isRpcReady.ts";
import type { StackKind } from "./identity.ts";

export type StackDescriptor = {
  instanceId: string;
  slot: number;
  kind: StackKind;
  worktreePath: string;
  chainPort: number;
  chainId: number;
  apiPort: number;
  appPort: number;
  reviewPort: number;
  resolutionPort: number;
  pcAdminPort: number;
  dbName: string;
  envFilePath: string;
  deployAddressesPath: string | null;
  controlPid: number;
  startedAt: string;
};

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

function descriptorPath(instanceId: string): string {
  return join(registryDir(), `${instanceId}.json`);
}

export function registryDir(): string {
  return (
    process.env.POPCHARTS_STACK_REGISTRY_DIR ??
    join(homedir(), ".popcharts", "local-stacks")
  );
}

export function writeDescriptor(descriptor: StackDescriptor): void {
  mkdirSync(registryDir(), { recursive: true });
  writeFileSync(
    descriptorPath(descriptor.instanceId),
    `${JSON.stringify(descriptor, null, 2)}\n`,
  );
}

export function removeDescriptor(instanceId: string): void {
  try {
    unlinkSync(descriptorPath(instanceId));
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw error;
    }
  }
}

export function readDescriptors(): StackDescriptor[] {
  let filenames: string[];

  try {
    filenames = readdirSync(registryDir()).filter((name) => name.endsWith(".json"));
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return [];
    }
    throw error;
  }

  const descriptors: StackDescriptor[] = [];
  for (const filename of filenames) {
    try {
      descriptors.push(
        JSON.parse(readFileSync(join(registryDir(), filename), "utf8")) as StackDescriptor,
      );
    } catch {
      // A malformed or concurrently removed descriptor must not hide live stacks.
    }
  }

  return descriptors;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

export async function isDescriptorAlive(
  descriptor: StackDescriptor,
): Promise<boolean> {
  if (!isProcessAlive(descriptor.controlPid)) {
    return false;
  }

  return isRpcReady(`http://127.0.0.1:${descriptor.chainPort}`);
}

export async function pruneDeadDescriptors(): Promise<StackDescriptor[]> {
  const liveDescriptors: StackDescriptor[] = [];

  for (const descriptor of readDescriptors()) {
    if (await isDescriptorAlive(descriptor)) {
      liveDescriptors.push(descriptor);
    } else {
      removeDescriptor(descriptor.instanceId);
    }
  }

  return liveDescriptors;
}
