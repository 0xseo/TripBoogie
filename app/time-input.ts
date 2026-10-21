/** Accept 24-hour clocks and compact keyboard input without guessing invalid times. */
export function normalizeTimeInput(input: string): string | null {
  const value = input.normalize("NFKC").trim();
  const match = /^(\d{1,2})(?::(\d{1,2}))?$/.exec(value);
  let hour: string, minute: string;
  if (match) {
    hour = match[1];
    minute = match[2] ?? "00";
  } else if (/^\d{3,4}$/.test(value)) {
    hour = value.slice(0, -2);
    minute = value.slice(-2);
  } else return null;
  if (Number(hour) > 23 || Number(minute) > 59) return null;
  return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}
