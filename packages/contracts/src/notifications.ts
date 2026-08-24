import { z } from 'zod'

export const sendUserNotificationSchema = z.object({
  recipientId: z.string().trim().min(1).max(120),
  title: z.string().trim().min(2).max(120),
  body: z.string().trim().min(1).max(500),
})

export type SendUserNotificationInput = z.infer<typeof sendUserNotificationSchema>
