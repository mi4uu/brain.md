interface Props {
  patch: string;
}

export function DiffView({ patch }: Props) {
  if (!patch.trim()) {
    return <p className="muted" style={{ padding: 16, textAlign: "center" }}>No differences.</p>;
  }
  const lines = patch.split(/\r?\n/);
  return (
    <pre className="diff scroll">
      {lines.map((line, i) => {
        const cls =
          line.startsWith("+++") || line.startsWith("---")
            ? "diff-meta"
            : line.startsWith("@@")
              ? "diff-hunk"
              : line.startsWith("+")
                ? "diff-add"
                : line.startsWith("-")
                  ? "diff-rm"
                  : line.startsWith("diff ")
                    ? "diff-meta"
                    : line.startsWith("index ")
                      ? "diff-meta"
                      : "diff-ctx";
        return (
          <div key={i} className={cls}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}
