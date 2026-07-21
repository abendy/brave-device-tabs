interface EmptyStateProps {
  copy: string;
  title: string;
}

export function EmptyState({ copy, title }: EmptyStateProps) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      <p className="empty-copy">{copy}</p>
    </div>
  );
}
