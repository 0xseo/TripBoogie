import { notFound } from "next/navigation";
import UxPreview from "./UxPreview";

export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <UxPreview />;
}
