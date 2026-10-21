import { LoaderCircle } from "lucide-react";

export default function Spinner({ size = 20, className = "" }: { size?: number; className?: string }) {
  return <LoaderCircle size={size} className={`spinner ${className}`} aria-hidden="true" />;
}
