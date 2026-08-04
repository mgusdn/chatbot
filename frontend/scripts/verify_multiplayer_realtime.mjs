import fs from "node:fs";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

function readEnv(path) {
  return Object.fromEntries(
    fs.readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [
          line.slice(0, separator),
          line.slice(separator + 1).replace(/^['"]|['"]$/g, ""),
        ];
      }),
  );
}

const env = readEnv(new URL("../.env.local", import.meta.url));
const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  realtime: { params: { eventsPerSecond: 10 } },
};
const first = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  clientOptions,
);
const second = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  clientOptions,
);
const topic = `room:prometheus:players:smoke:${Date.now()}`;
const firstChannel = first.channel(topic, { config: { presence: { key: "smoke-a" } } });
const secondChannel = second.channel(topic, { config: { presence: { key: "smoke-b" } } });
let firstReceivedSequence = null;
let secondReceivedSequence = null;
let explicitLeaveSeen = false;

firstChannel
  .on("broadcast", { event: "player-state" }, ({ payload }) => {
    firstReceivedSequence = payload?.sequence ?? null;
  })
  .on("presence", { event: "sync" }, () => {});
secondChannel
  .on("broadcast", { event: "player-state" }, ({ payload }) => {
    secondReceivedSequence = payload?.sequence ?? null;
  })
  .on("broadcast", { event: "player-left" }, ({ payload }) => {
    if (payload?.playerId === "smoke-a") explicitLeaveSeen = true;
  })
  .on("presence", { event: "sync" }, () => {});

function subscribe(channel, label) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label} subscription timeout`)), 10_000);
    channel.subscribe((status, error) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timeout);
        resolve();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timeout);
        reject(error || new Error(`${label} ${status}`));
      }
    });
  });
}

async function waitFor(predicate, label, timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) throw new Error(`${label} timeout`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

try {
  await subscribe(firstChannel, "first");
  const firstTrackStatus = await firstChannel.track({ playerId: "smoke-a", characterId: "snowy", scene: "interior" });
  await subscribe(secondChannel, "second");
  const secondTrackStatus = await secondChannel.track({ playerId: "smoke-b", characterId: "cat", scene: "interior" });
  if (firstTrackStatus !== "ok" || secondTrackStatus !== "ok") {
    throw new Error(`presence track failed: ${firstTrackStatus}, ${secondTrackStatus}`);
  }
  const firstBroadcastStatus = await firstChannel.send({
    type: "broadcast",
    event: "player-state",
    payload: { playerId: "smoke-a", sequence: 1, position: [1, 0.78, -2] },
  });
  const secondBroadcastStatus = await secondChannel.send({
    type: "broadcast",
    event: "player-state",
    payload: { playerId: "smoke-b", sequence: 2, position: [-1, 0.78, 2] },
  });
  await waitFor(
    () => firstReceivedSequence === 2 && secondReceivedSequence === 1,
    "two-way broadcast delivery",
  );
  await firstChannel.send({
    type: "broadcast",
    event: "player-left",
    payload: { playerId: "smoke-a", connectionId: "smoke-connection-a" },
  });
  await waitFor(() => explicitLeaveSeen, "explicit leave delivery");
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  const presencePeersSeen = Math.max(
    Object.keys(firstChannel.presenceState()).length,
    Object.keys(secondChannel.presenceState()).length,
  );
  await first.removeChannel(firstChannel);
  console.log(JSON.stringify({
    firstTrackStatus,
    secondTrackStatus,
    presencePeersSeen,
    firstBroadcastStatus,
    secondBroadcastStatus,
    firstReceivedSequence,
    secondReceivedSequence,
    explicitLeaveSeen,
  }));
} finally {
  await first.removeAllChannels();
  await second.removeAllChannels();
  first.realtime.disconnect();
  second.realtime.disconnect();
}
