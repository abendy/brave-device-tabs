import type { StatusMessage } from "../types";

interface StatusProps {
  message: StatusMessage | null;
}

export function Status({ message }: StatusProps) {
  if (!message) {
    return null;
  }
  return (
    <div className={`status${message.kind === "error" ? " error" : ""}`} role="status">
      {message.text}
    </div>
  );
}
