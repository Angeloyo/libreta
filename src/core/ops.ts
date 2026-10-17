// The operations that change a board. The agent and the human editor use the same ones.
// Placement is by intent (in a frame, after a sibling, right of a shape); `at` is for exact spots.

import { z } from 'zod'
import { didYouMean } from './suggest.ts'

const Id = z.string().regex(/^[A-Za-z][\w-]*$/, 'ids are short words like "api" or "db-2"')
const Point = z.tuple([z.number(), z.number()])
const EndRef = z.union([Id, Point])

const style = {
  color: z.enum(['black', 'grey', 'blue', 'violet', 'green', 'yellow', 'orange', 'red', 'pink']).optional(),
  fill: z.enum(['none', 'light', 'solid']).optional(),
  stroke: z.enum(['solid', 'dashed', 'dotted']).optional(),
  size: z.enum(['s', 'm', 'l', 'xl']).optional(),
}

const frameFields = {
  layout: z.enum(['none', 'row', 'col', 'grid', 'table']).optional(),
  spacing: z.number().min(0).optional(),
  cols: z.number().int().min(1).optional(),
}

const placement = {
  in: Id.nullable().optional(),
  after: Id.optional(),
  before: Id.optional(),
  right_of: Id.optional(),
  left_of: Id.optional(),
  above: Id.optional(),
  below: Id.optional(),
  near: Id.optional(),
  gap: z.number().optional(),
  align: z.enum(['start', 'center', 'end']).optional(),
  at: Point.optional(),
}

const size = { w: z.number().positive().optional(), h: z.number().positive().optional() }

export const CreateOp = z.strictObject({
  op: z.literal('create'),
  kind: z.enum(['box', 'ellipse', 'diamond', 'text', 'sticky', 'frame', 'pen']),
  id: Id.optional(),
  text: z.string().optional(),
  points: z.array(z.array(z.number())).optional(),
  ...style,
  ...frameFields,
  ...placement,
  ...size,
})

export const ConnectOp = z.strictObject({
  op: z.literal('connect'),
  id: Id.optional(),
  from: EndRef,
  to: EndRef,
  text: z.string().optional(),
  heads: z.enum(['end', 'both', 'none']).optional(),
  ...style,
})

export const UpdateOp = z.strictObject({
  op: z.literal('update'),
  id: Id,
  /** Frames: shrink (or grow) to hug their children. */
  fit: z.boolean().optional(),
  text: z.string().optional(),
  from: EndRef.optional(),
  to: EndRef.optional(),
  heads: z.enum(['end', 'both', 'none']).optional(),
  points: z.array(z.array(z.number())).optional(),
  ...style,
  ...frameFields,
  ...size,
})

export const MoveOp = z.strictObject({
  op: z.literal('move'),
  id: Id,
  by: Point.optional(),
  ...placement,
})

export const DeleteOp = z.strictObject({ op: z.literal('delete'), id: Id })

export const Op = z.discriminatedUnion('op', [CreateOp, ConnectOp, UpdateOp, MoveOp, DeleteOp])
export type Op = z.infer<typeof Op>
export type CreateOp = z.infer<typeof CreateOp>
export type ConnectOp = z.infer<typeof ConnectOp>
export type UpdateOp = z.infer<typeof UpdateOp>
export type MoveOp = z.infer<typeof MoveOp>

const OP_NAMES = ['create', 'connect', 'update', 'move', 'delete']
const keysOf: Record<string, string[]> = {
  create: Object.keys(CreateOp.shape),
  connect: Object.keys(ConnectOp.shape),
  update: Object.keys(UpdateOp.shape),
  move: Object.keys(MoveOp.shape),
  delete: Object.keys(DeleteOp.shape),
}

/** Validates raw ops. Returns readable errors that say what to change. */
export function parseOps(raw: unknown[], label = (i: number) => `op ${i + 1}`): { ops: Op[]; errors: string[] } {
  const ops: Op[] = []
  const errors: string[] = []
  raw.forEach((item, i) => {
    const where = label(i)
    const name = (item as { op?: unknown })?.op
    if (typeof name !== 'string' || !OP_NAMES.includes(name)) {
      errors.push(`${where}: "op" must be one of ${OP_NAMES.join(', ')}${typeof name === 'string' ? didYouMean(name, OP_NAMES) : ''}`)
      return
    }
    const result = Op.safeParse(item)
    if (result.success) {
      ops.push(result.data)
      return
    }
    for (const issue of result.error.issues) {
      if (issue.code === 'unrecognized_keys') {
        for (const key of issue.keys) errors.push(`${where} (${name}): unknown key "${key}"${didYouMean(key, keysOf[name])}`)
      } else {
        const field = issue.path.join('.') || 'value'
        errors.push(`${where} (${name}): ${field}: ${issue.message}`)
      }
    }
  })
  return { ops, errors }
}
