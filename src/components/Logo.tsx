import Image from "next/image";
import { cn } from "@/lib/utils";

export default function Logo({ className }: { className?: string }) {
  return (
    <Image
      src="/logo-uptech-white.svg"
      alt="UPTECH"
      width={180}
      height={44}
      className={cn("theme-logo h-10 w-auto object-contain sm:h-12", className)}
      priority
    />
  );
}
