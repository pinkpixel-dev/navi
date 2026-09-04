interface EmptyChatGreeting {
  /** Shown when a display name is set. `{name}` is replaced with it. */
  withName: string;
  /** Shown when no display name is set, phrased to stand on its own. */
  withoutName: string;
}

export const emptyChatGreetings: EmptyChatGreeting[] = [
  { withName: "Ready when you are, {name}.", withoutName: "Ready when you are." },
  { withName: "What are we working on, {name}?", withoutName: "What are we working on?" },
  { withName: "What's on your mind, {name}?", withoutName: "What's on your mind?" },
  { withName: "Your move, {name}.", withoutName: "Your move." },
  { withName: "I'm listening, {name}.", withoutName: "I'm listening." },
  { withName: "Let's get to it, {name}.", withoutName: "Let's get to it." },
  { withName: "What's the plan, {name}?", withoutName: "What's the plan?" },
  { withName: "Let's make it happen, {name}.", withoutName: "Let's make it happen." },
  { withName: "Fire away, {name}.", withoutName: "Fire away." },
  { withName: "I'm all yours, {name}.", withoutName: "I'm all yours." },
  { withName: "What's next, {name}?", withoutName: "What's next?" },
  { withName: "Okay, {name}. Whatcha got?", withoutName: "Okay. Whatcha got?" },
  { withName: "Hit me with it, {name}.", withoutName: "Hit me with it." },
  { withName: "I've got tokens to burn, {name}.", withoutName: "I've got tokens to burn." },
  { withName: "What's the mission, {name}?", withoutName: "What's the mission?" },
];

/**
 * Spreads conversation ids across the greeting list. Keyed on the id rather than
 * picked at random so a chat keeps the same greeting across re-renders and only
 * changes when you open a different chat.
 */
function greetingIndexFor(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 1_000_000_007;
  }
  return hash % emptyChatGreetings.length;
}

export function pickEmptyChatGreeting(seed: string, displayName?: string): string {
  const greeting = emptyChatGreetings[greetingIndexFor(seed)];
  const name = displayName?.trim();
  return name ? greeting.withName.replace("{name}", name) : greeting.withoutName;
}
