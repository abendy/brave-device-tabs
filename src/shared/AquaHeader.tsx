import type { ReactNode } from "react";

interface AquaHeaderProps {
  children?: ReactNode;
  emphasis: string;
  title: string;
}

export function AquaHeader({ children, emphasis, title }: AquaHeaderProps) {
  return (
    <header className="app-header">
      <div aria-hidden="true" className="orbs">
        <span className="orb orb-red" />
        <span className="orb orb-yellow" />
        <span className="orb orb-green" />
      </div>
      <h1 id="app-title">
        {title} <em>{emphasis}</em>
      </h1>
      {children}
    </header>
  );
}
