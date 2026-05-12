import React from "react";
import { Info } from "@phosphor-icons/react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface InfoTooltipProps {
  text: string;
  className?: string;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
}

export const InfoTooltip: React.FC<InfoTooltipProps> = ({
  text,
  className,
  side = "top",
  align = "start",
}) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="More information"
          className={cn(
            "inline-flex shrink-0 align-middle text-slate-400 transition-colors hover:text-slate-700",
            className,
          )}
        >
          <Info size={14} weight="regular" />
        </button>
      </TooltipTrigger>
      <TooltipContent side={side} align={align}>
        {text}
      </TooltipContent>
    </Tooltip>
  );
};
