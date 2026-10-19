import type { ImgHTMLAttributes } from "react";
// Native builds bundle public assets; Next's server image optimizer is absent.
export default function Image(props: ImgHTMLAttributes<HTMLImageElement>) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...props} alt={props.alt ?? ""} />;
}
