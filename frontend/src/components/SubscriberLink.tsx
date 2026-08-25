import { Link } from "react-router-dom";

export default function SubscriberLink({
  subscriber,
  className = "",
}: {
  subscriber: string;
  className?: string;
}) {
  if (!subscriber) {
    return <span className="text-slate-400">—</span>;
  }
  return (
    <Link
      to={`/subscribers/${encodeURIComponent(subscriber)}`}
      className={`font-mono text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300 ${className}`}
    >
      {subscriber}
    </Link>
  );
}