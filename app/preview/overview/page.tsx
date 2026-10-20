import { notFound } from "next/navigation";
import OverviewPreview from "./OverviewPreview";

export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <OverviewPreview />;
}
