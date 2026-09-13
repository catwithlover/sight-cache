import { z } from 'zod'

export const createDeviceInputSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1, '請輸入設備名稱')
    .max(80, '設備名稱不可超過 80 個字元'),
})

export const deviceIdSchema = z.uuid()
