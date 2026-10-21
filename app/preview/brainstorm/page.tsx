import { notFound } from "next/navigation";
import BrainPreview from "./BrainPreview";
export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <BrainPreview/>;
}
