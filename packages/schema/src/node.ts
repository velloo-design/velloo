import { z } from "zod";

export type Node = {
  $ref: string;
  props?: Record<string, unknown>;
  children?: Node[];
};

export const NodeSchema: z.ZodType<Node> = z.lazy(() =>
  z.object({
    $ref: z.string().min(1),
    props: z.record(z.string(), z.unknown()).optional(),
    children: z.array(NodeSchema).optional(),
  }),
);
