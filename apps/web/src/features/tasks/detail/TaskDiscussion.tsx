import { useMutation, useQueryClient, type InfiniteData, type UseInfiniteQueryResult } from '@tanstack/react-query'
import type { StructuredMentionInput, TaskActivityPage, TaskAttachmentView, TaskDetailView } from '@lankadws/contracts'
import { ArrowDown, ChevronUp, Copy, HardDrive, Heart, MessageCircle, Paperclip, Pencil, Reply, Send, Trash2, X } from 'lucide-react'
import { type Dispatch, type SetStateAction, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ApiProblem, api, idempotencyKey, jsonBody } from '../../../shared/api/client'
import { useAuth } from '../../../shared/auth/AuthProvider'
import { formatDateTime } from '../../../shared/lib/format'
import { personName } from '../../../shared/lib/personName'
import { DrivePicker } from '../../drive/DrivePicker'
import { UserProfileLink } from '../../employees/UserProfileDrawer'
import { formatChatTime } from '../../messages/lib/chatDates'
import { useDiscardDraftAttachment } from '../../../shared/files/useDiscardDraftAttachment'
import { FileDropOverlay, useFileDropTarget } from '../../../shared/files/FileDropzone'
import { FormattedText } from '../../../shared/text/FormattedText'
import { MentionTextarea } from '../../../shared/mentions/MentionTextarea'
import { trimMentionValue } from '../../../shared/mentions/mentionText'
import { MessageComposerFrame } from '../../../shared/messages/MessageComposerFrame'
import { MessageLikeButton } from '../../../shared/messages/MessageLikeButton'
import { Avatar, Button, Skeleton } from '../../../shared/ui'
import { TaskAttachment, TaskFilesArchive } from './taskFiles'
import { refreshTask } from './useTaskDetail'

function contextMenuPosition(x: number, y: number): { left: number; top: number } {
  const menuWidth = 248
  const menuHeight = 260
  const inset = 8
  return {
    left: Math.max(inset, Math.min(x, window.innerWidth - menuWidth - inset)),
    top: Math.max(inset, Math.min(y, window.innerHeight - menuHeight - inset)),
  }
}

export function TaskDiscussion({
  id,
  task,
  activity,
  canAttachFiles,
  attachmentBusy,
  commentAttachments,
  setCommentAttachments,
  uploadFiles,
  attachFromDrive,
  setContentMessage,
  onDraftDirtyChange,
}: {
  id: string
  task: TaskDetailView
  activity: UseInfiniteQueryResult<InfiniteData<TaskActivityPage>, Error>
  canAttachFiles: boolean
  attachmentBusy: boolean
  commentAttachments: TaskAttachmentView[]
  setCommentAttachments: Dispatch<SetStateAction<TaskAttachmentView[]>>
  uploadFiles: (files: File[], selectForComment: boolean) => Promise<void>
  attachFromDrive: (fileId: string) => Promise<unknown>
  setContentMessage: (message: string) => void
  onDraftDirtyChange: (dirty: boolean) => void
}) {
  const client = useQueryClient()
  const { user } = useAuth()
  const [discussionExpanded, setDiscussionExpanded] = useState(false)
  const [showDiscussionTop, setShowDiscussionTop] = useState(false)
  const discussionRef = useRef<HTMLElement>(null)
  const discussionBodyRef = useRef<HTMLDivElement>(null)
  const discussionContentRef = useRef<HTMLDivElement>(null)
  const [comment, setComment] = useState('')
  const [commentMentions, setCommentMentions] = useState<StructuredMentionInput[]>([])
  const [editingComment, setEditingComment] = useState<{
    id: string
    body: string
    mentions: StructuredMentionInput[]
  } | null>(null)
  const [openCommentMenu, setOpenCommentMenu] = useState<{
    id: string
    left: number
    top: number
  } | null>(null)
  const commentMenuCloseTimerRef = useRef<number | null>(null)
  const commentAttemptRef = useRef({ signature: '', key: '' })
  const commentFileInputRef = useRef<HTMLInputElement>(null)
  const commentTextareaRef = useRef<HTMLTextAreaElement>(null)
  const [replyTo, setReplyTo] = useState<{
    id: string
    authorName: string
    body: string
  } | null>(null)
  const commentAttachmentIds = commentAttachments.map((attachment) => attachment.id)
  const [drivePickerOpen, setDrivePickerOpen] = useState(false)
  const commentFileRemoval = useDiscardDraftAttachment((fileId) => {
    setCommentAttachments((current) => current.filter((item) => item.id !== fileId))
  })
  const closeCommentMenu = () => {
    if (commentMenuCloseTimerRef.current !== null) window.clearTimeout(commentMenuCloseTimerRef.current)
    setOpenCommentMenu(null)
  }
  const delayCommentMenuClose = () => {
    commentMenuCloseTimerRef.current = window.setTimeout(closeCommentMenu, 120)
  }
  const keepCommentMenuOpen = () => {
    if (commentMenuCloseTimerRef.current !== null) window.clearTimeout(commentMenuCloseTimerRef.current)
  }
  useEffect(() => {
    const closeOnOtherMenu = () => closeCommentMenu()
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest('.task-comment-action-menu')) closeCommentMenu()
    }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') closeCommentMenu() }
    window.addEventListener('lanka:context-menu-open', closeOnOtherMenu)
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('lanka:context-menu-open', closeOnOtherMenu)
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [])
  const draftDirty = Boolean(comment.trim() || replyTo || editingComment)
  useEffect(() => {
    onDraftDirtyChange(draftDirty)
  }, [draftDirty, onDraftDirtyChange])
  const post = useMutation({
    mutationFn: (input: {
      body: string
      replyToCommentId: string | null
      attachmentIds: string[]
      mentions: StructuredMentionInput[]
      key: string
      keepDraft?: boolean
    }) => {
      const { key, keepDraft: _keepDraft, ...body } = input
      return api(`/tasks/${id}/comments`, {
        method: 'POST',
        headers: { 'idempotency-key': key },
        body: jsonBody(body),
      })
    },
    onSuccess: (_result, input) => {
      if (!input.keepDraft) {
        setComment('')
        setCommentMentions([])
        commentAttemptRef.current = { signature: '', key: '' }
        setReplyTo(null)
        setCommentAttachments([])
        window.requestAnimationFrame(() => commentTextareaRef.current?.focus())
      }
      setContentMessage('')
      refreshTask(client, id)
    },
    onError: () => setContentMessage('Не вдалося надіслати коментар. Перевірте текст і вкладення.'),
  })
  const updateComment = useMutation({
    mutationFn: (input: {
      commentId: string
      body: string
      mentions: StructuredMentionInput[]
      expectedVersion: number
    }) => api(`/tasks/${id}/comments/${encodeURIComponent(input.commentId)}`, {
      method: 'PATCH',
      body: jsonBody({
        body: input.body,
        mentions: input.mentions,
        expectedVersion: input.expectedVersion,
      }),
    }),
    onSuccess: () => {
      setEditingComment(null)
      setContentMessage('Повідомлення відредаговано.')
      refreshTask(client, id)
    },
    onError: (error) => setContentMessage(
      error instanceof ApiProblem && error.problem.status === 409
        ? 'Повідомлення вже змінилося. Оновіть завдання та повторіть дію.'
        : 'Не вдалося відредагувати повідомлення.',
    ),
  })
  const deleteComment = useMutation({
    mutationFn: (input: { commentId: string; expectedVersion: number }) =>
      api(`/tasks/${id}/comments/${encodeURIComponent(input.commentId)}`, {
        method: 'DELETE',
        body: jsonBody({ expectedVersion: input.expectedVersion }),
      }),
    onSuccess: (_result, input) => {
      setEditingComment((current) => current?.id === input.commentId ? null : current)
      setContentMessage('Повідомлення видалено.')
      refreshTask(client, id)
    },
    onError: (error) => setContentMessage(
      error instanceof ApiProblem && error.problem.status === 409
        ? 'Повідомлення вже змінилося. Оновіть завдання та повторіть дію.'
        : 'Не вдалося видалити повідомлення.',
    ),
  })
  const reactToComment = useMutation({
    mutationFn: (item: TaskDetailView['comments'][number]) => api(
      `/tasks/${id}/comments/${encodeURIComponent(item.id)}/reactions`,
      {
        method: item.reactions.likedByMe ? 'DELETE' : 'POST',
        body: jsonBody({ kind: 'LIKE' }),
      },
    ),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['task', id] }),
    onError: () => setContentMessage('Не вдалося змінити вподобання повідомлення.'),
  })
  const commentFilesDrop = useFileDropTarget({
    disabled: !canAttachFiles || commentAttachmentIds.length >= 5,
    onFiles: (files) => void uploadFiles(files.slice(0, 5 - commentAttachmentIds.length), true),
  })
  const discussionEntries = [
    ...(task.comments.map((item) => ({
      kind: 'comment' as const,
      id: item.id,
      createdAt: item.createdAt,
      item,
    })) ?? []),
    ...(activity.data?.pages
      .flatMap((pageResult) => pageResult.items)
      .filter((item) => item.action !== 'task.comment_created')
      .map((item) => ({
        kind: 'activity' as const,
        id: item.id,
        createdAt: item.createdAt,
        item,
      })) ?? []),
  ].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
  const visibleDiscussionEntries = discussionExpanded
    ? discussionEntries
    : discussionEntries.slice(-11)

  useEffect(() => {
    setDiscussionExpanded(false)
    setShowDiscussionTop(false)
  }, [id])

  // Reserve a clipped older message above the complete recent messages as a history cue.
  useLayoutEffect(() => {
    const body = discussionBodyRef.current
    const content = discussionContentRef.current
    if (!body || !content) return
    const measure = () => {
      const children = Array.from(content.children) as HTMLElement[]
      const bodyStyle = getComputedStyle(body)
      const available = body.clientHeight - parseFloat(bodyStyle.paddingTop || '0') - parseFloat(bodyStyle.paddingBottom || '0')
      const gap = parseFloat(getComputedStyle(content).rowGap || '0') || 0
      for (const child of children) child.classList.remove('is-history-peek')
      const heights = children.map((child) => child.getBoundingClientRect().height)
      const budget = available
      let used = 0
      let fullCount = 0
      let peekShown = false
      for (let index = children.length - 1; index >= 0; index--) {
        const child = children[index]
        const fits = discussionExpanded || (!peekShown && fullCount < 10 && used + heights[index] <= budget)
        const peek = !discussionExpanded && !fits && !peekShown
        if (peek) child.style.setProperty('--history-peek-height', `${Math.max(0, available - used)}px`)
        if (peek) peekShown = true
        child.classList.toggle('is-history-peek', peek)
        child.style.visibility = fits || peek ? '' : 'hidden'
        child.inert = !fits
        if (fits) {
          used += heights[index] + gap
          fullCount++
        }
      }
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(body)
    observer.observe(content)
    for (const child of content.children) observer.observe(child)
    return () => observer.disconnect()
  }, [discussionExpanded, task, activity.data])

  useEffect(() => {
    if (discussionExpanded && activity.hasNextPage && !activity.isFetchingNextPage && !activity.isFetchNextPageError) {
      void activity.fetchNextPage().catch(() => undefined)
    }
  }, [discussionExpanded, activity.hasNextPage, activity.isFetchingNextPage, activity.isFetchNextPageError, activity.fetchNextPage])

  useEffect(() => {
    const update = () => setShowDiscussionTop(
      discussionExpanded && (discussionRef.current?.getBoundingClientRect().top ?? 0) < -80,
    )
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [discussionExpanded])

  const scrollToDiscussion = () => {
    discussionRef.current?.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' })
  }
  return (
    <section
      ref={discussionRef}
      className={`task-discussion is-file-drop-target${discussionExpanded ? ' is-expanded' : ''}`}
      data-task-section="discussion"
      aria-labelledby={`task-discussion-${id}`}
      {...commentFilesDrop.dropTargetProps}
    >
      <FileDropOverlay active={commentFilesDrop.isDragging} label="Відпустіть файли, щоб додати до коментаря" />
      <header>
        <span className="task-discussion__title">
          <span className="task-detail-card-icon"><MessageCircle size={18} /></span>
          <h3 id={`task-discussion-${id}`}>Обговорення</h3>
        </span>
        <Button
          type="button"
          variant="ghost"
          className="task-discussion__expand"
          aria-expanded={discussionExpanded}
          aria-controls={`task-discussion-body-${id}`}
          onClick={() => {
            if (discussionExpanded) scrollToDiscussion()
            setDiscussionExpanded((expanded) => !expanded)
          }}
        >
          <ArrowDown size={16} aria-hidden="true" />
          {discussionExpanded ? 'Згорнути чат' : 'Розгорнути чат'}
        </Button>
      </header>
      <div
        id={`task-discussion-body-${id}`}
        ref={discussionBodyRef}
        className="task-discussion__body"
        aria-label="Повідомлення та історія обговорення"
      >
      {visibleDiscussionEntries.length > 0 ? (
        <div ref={discussionContentRef} className="task-comments">
          {visibleDiscussionEntries.map((entry) => {
            if (entry.kind === 'activity') {
              return (
                <div className="task-system-event" key={entry.id}>
                  <time dateTime={entry.item.createdAt}>{formatDateTime(entry.item.createdAt)}</time>
                  <span>
                    {entry.item.actor?.displayName
                      ? `${personName(entry.item.actor.displayName)} · ${entry.item.label}`
                      : entry.item.label}
                  </span>
                </div>
              )
            }
            const item = entry.item
            const ownComment = item.author.id === user?.id
            return (
              <div className="task-comment-row" key={item.id}>
              <article
                className={`task-comment ${ownComment ? 'is-own' : 'is-other'}${item.replyToCommentId ? ' is-reply' : ''}`}
                onContextMenu={(event) => {
                  if ((event.target as HTMLElement).closest('button, a, input, textarea')) return
                  event.preventDefault()
                  window.dispatchEvent(new CustomEvent('lanka:context-menu-open'))
                  setOpenCommentMenu({ id: item.id, ...contextMenuPosition(event.clientX, event.clientY) })
                }}
              >
                <UserProfileLink
                  className="task-comment__author-avatar"
                  userId={item.author.id}
                  aria-label={`Відкрити профіль ${personName(item.author.displayName)}`}
                >
                  <Avatar
                    size="sm"
                    name={personName(item.author.displayName)}
                    src={item.author.avatarAsset}
                  />
                </UserProfileLink>
                <div className="task-comment__bubble">
                  <div className="task-comment__heading">
                    <UserProfileLink className="task-comment__author" userId={item.author.id}>
                      {personName(item.author.displayName)}
                    </UserProfileLink>
                    <time dateTime={item.createdAt} title={formatDateTime(item.createdAt)}>
                      {new Date(item.createdAt).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' })} {formatChatTime(item.createdAt)}
                    </time>
                  </div>
                  {item.replyPreview && (
                    <blockquote>
                      <strong>{personName(item.replyPreview.authorName)}</strong>
                      <span>{item.replyPreview.body}</span>
                    </blockquote>
                  )}
                  {editingComment?.id === item.id ? (
                    <form
                      className="task-comment-edit-form"
                      onSubmit={(event) => {
                        event.preventDefault()
                        const trimmed = trimMentionValue(
                          editingComment.body,
                          editingComment.mentions,
                        )
                        if (!trimmed.body) return
                        updateComment.mutate({
                          commentId: item.id,
                          body: trimmed.body,
                          mentions: trimmed.mentions,
                          expectedVersion: item.version,
                        })
                      }}
                    >
                      <MentionTextarea
                        label="Редагувати повідомлення"
                        value={editingComment.body}
                        mentions={editingComment.mentions}
                        candidateUrl={`/tasks/${id}/mention-candidates`}
                        onChange={(body, mentions) => setEditingComment({
                          id: item.id,
                          body,
                          mentions,
                        })}
                        rows={3}
                        maxLength={4000}
                        autoFocus
                        visuallyHiddenLabel
                      />
                      <div>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setEditingComment(null)}
                        >
                          Скасувати
                        </Button>
                        <Button disabled={!editingComment.body.trim() || updateComment.isPending}>
                          Зберегти
                        </Button>
                      </div>
                    </form>
                  ) : item.body.trim() ? (
                    <FormattedText body={item.body} mentions={item.mentions} hideMentionPrefix />
                  ) : null}
                  {editingComment?.id !== item.id && item.attachments.length > 0 && (
                    <div className="task-comment-attachments">
                      {item.attachments.map((attachment) => (
                        <TaskAttachment key={attachment.id} attachment={attachment} compact />
                      ))}
                      <TaskFilesArchive attachments={item.attachments} />
                    </div>
                  )}
                  {editingComment?.id !== item.id && (
                    <footer className="task-comment__meta">
                      {item.editedAt && <span>змінено</span>}
                    </footer>
                  )}
                  {editingComment?.id !== item.id && (
                    openCommentMenu?.id === item.id && (
                        <div
                          className="task-comment-action-menu"
                          role="menu"
                          aria-label="Дії з повідомленням"
                          style={{ left: openCommentMenu.left, top: openCommentMenu.top }}
                          onMouseEnter={keepCommentMenuOpen}
                          onMouseLeave={delayCommentMenuClose}
                        >
                          <button
                            type="button"
                            disabled={reactToComment.isPending}
                            onClick={() => {
                              closeCommentMenu()
                              reactToComment.mutate(item)
                            }}
                          >
                            <Heart size={14} /> {item.reactions.likedByMe ? 'Прибрати вподобання' : 'Подобається'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              closeCommentMenu()
                              setReplyTo({
                                id: item.id,
                                authorName: personName(item.author.displayName),
                                body: item.body,
                              })
                            }}
                          >
                            <Reply size={14} /> Відповісти
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              closeCommentMenu()
                              void navigator.clipboard.writeText(item.body)
                                .then(() => setContentMessage('Текст повідомлення скопійовано.'))
                                .catch(() => setContentMessage('Не вдалося скопіювати текст повідомлення.'))
                            }}
                          >
                            <Copy size={14} /> Копіювати текст
                          </button>
                          {item.canEdit && (
                            <button
                              type="button"
                              onClick={() => {
                                closeCommentMenu()
                                setEditingComment({
                                  id: item.id,
                                  body: item.body,
                                  mentions: item.mentions.map((mention) => ({
                                    userId: mention.userId,
                                    start: mention.start,
                                    end: mention.end,
                                    label: item.body.slice(mention.start + 1, mention.end),
                                  })),
                                })
                              }}
                            >
                              <Pencil size={14} /> Редагувати
                            </button>
                          )}
                          {item.canDelete && (
                            <button
                              type="button"
                              className="is-danger"
                              disabled={deleteComment.isPending}
                              onClick={() => {
                                if (!window.confirm('Видалити це повідомлення?')) return
                                closeCommentMenu()
                                deleteComment.mutate({ commentId: item.id, expectedVersion: item.version })
                              }}
                            >
                              <Trash2 size={14} /> Видалити
                            </button>
                          )}
                        </div>
                      )
                  )}
                </div>
                {editingComment?.id !== item.id && (
                  <div className="task-comment__side-actions" aria-label="Швидкі дії з повідомленням">
                    {item.reactions.likeCount > 0 ? (
                      <MessageLikeButton
                        previewPlacement="right"
                        reactionsUrl={`/tasks/${encodeURIComponent(id)}/comments/${encodeURIComponent(item.id)}/reactions`}
                        count={item.reactions.likeCount}
                        liked={item.reactions.likedByMe}
                        onClick={() => { if (!reactToComment.isPending) reactToComment.mutate(item) }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="message-like-button task-comment__reveal-action"
                        aria-label="Подобається"
                        aria-pressed={false}
                        disabled={reactToComment.isPending}
                        onClick={() => reactToComment.mutate(item)}
                      >
                        <Heart size={13} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="task-comment__reply-action task-comment__reveal-action"
                      aria-label="Відповісти"
                      title="Відповісти"
                      onClick={() => {
                        setReplyTo({ id: item.id, authorName: personName(item.author.displayName), body: item.body })
                        commentTextareaRef.current?.focus()
                      }}
                    >
                      <Reply size={14} />
                    </button>
                  </div>
                )}
              </article>
              </div>
            )
          })}
        </div>
      ) : activity.isLoading ? (
        <Skeleton rows={2} />
      ) : (
        <p className="muted">Ще немає повідомлень. Додайте перше корисне уточнення.</p>
      )}
      {discussionExpanded && activity.isFetchingNextPage && <div className="task-discussion__older">Завантажуємо давнішу історію…</div>}
      </div>
      {discussionExpanded && activity.isFetchNextPageError && (
        <Button type="button" variant="ghost" onClick={() => void activity.fetchNextPage()}>
          Повторити завантаження історії
        </Button>
      )}
      {showDiscussionTop && (
        <button type="button" className="task-discussion__to-top" aria-label="До початку чату" title="До початку чату" onClick={scrollToDiscussion}>
          <ChevronUp size={24} />
        </button>
      )}
      <form
        className="task-comment-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (post.isPending || commentFileRemoval.isPending()) return
          const trimmed = trimMentionValue(comment, commentMentions)
          if (trimmed.body || commentAttachmentIds.length > 0) {
            const signature = JSON.stringify({
              taskId: id,
              body: trimmed.body,
              mentions: trimmed.mentions,
              replyToCommentId: replyTo?.id ?? null,
              attachmentIds: commentAttachmentIds,
            })
            if (commentAttemptRef.current.signature !== signature) {
              commentAttemptRef.current = {
                signature,
                key: idempotencyKey('task-comment'),
              }
            }
            post.mutate({
              body: trimmed.body,
              mentions: trimmed.mentions,
              replyToCommentId: replyTo?.id ?? null,
              attachmentIds: commentAttachmentIds,
              key: commentAttemptRef.current.key,
            })
          }
        }}
      >
        <MessageComposerFrame
          className="task-comment-composer"
          reply={replyTo && (
            <div className="message-composer__reply">
              <span>
                <strong>Відповідь: {personName(replyTo.authorName)}</strong>
                <small>{replyTo.body.slice(0, 120)}</small>
              </span>
              <button type="button" aria-label="Скасувати відповідь" onClick={() => setReplyTo(null)}>
                <X size={17} />
              </button>
            </div>
          )}
          attachments={commentAttachmentIds.length > 0 && (
            <div className="message-composer__attachments" aria-label="Файли коментаря">
              {commentAttachments.map((attachment) => {
                const fileId = attachment.id
                const fileName = attachment.fileName
                return (
                  <span key={fileId}>
                    <TaskAttachment attachment={attachment} composer />
                    <button
                      type="button"
                      aria-label={`Прибрати ${fileName} з коментаря`}
                      disabled={post.isPending || commentFileRemoval.pending}
                      onClick={() => void commentFileRemoval.discard(fileId)}
                    >
                      <X size={14} />
                    </button>
                  </span>
                )
              })}
            </div>
          )}
          leadingActions={(
            <>
              <input
                ref={commentFileInputRef}
                type="file"
                hidden
                multiple
                disabled={!canAttachFiles || commentAttachmentIds.length >= 5}
                onChange={(event) => {
                  void uploadFiles(
                    [...event.target.files ?? []].slice(0, 5 - commentAttachmentIds.length),
                    true,
                  )
                  event.currentTarget.value = ''
                }}
              />
              <button
                type="button"
                aria-label="Додати файли"
                title="Додати файли або перетягнути їх у поле вводу"
                disabled={!canAttachFiles || commentAttachmentIds.length >= 5}
                onClick={() => commentFileInputRef.current?.click()}
              >
                <Paperclip size={21} />
              </button>
              <button
                type="button"
                aria-label="Прикріпити з Диска"
                title="Прикріпити файл із Диска"
                disabled={!canAttachFiles || commentAttachmentIds.length >= 5}
                onClick={() => setDrivePickerOpen(true)}
              >
                <HardDrive size={20} />
              </button>
            </>
          )}
          input={(
            <MentionTextarea
              className="message-composer__input"
              label="Коментар до завдання"
              value={comment}
              mentions={commentMentions}
              candidateUrl={`/tasks/${id}/mention-candidates`}
              onTextareaRef={(element) => { commentTextareaRef.current = element }}
              onChange={(value, mentions) => {
                setComment(value)
                setCommentMentions(mentions)
              }}
              rows={1}
              maxLength={4000}
              visuallyHiddenLabel
              placeholder={replyTo ? 'Напишіть коротку відповідь…' : 'Напишіть повідомлення…'}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
                event.preventDefault()
                event.currentTarget.closest('form')?.requestSubmit()
              }}
              onPaste={(event) => {
                const files = [...event.clipboardData.files]
                if (!files.length) return
                event.preventDefault()
                if (!canAttachFiles || post.isPending || commentFileRemoval.pending) return
                void uploadFiles(files.slice(0, 5 - commentAttachmentIds.length), true)
              }}
            />
          )}
          sendAction={(
            <button
              type="submit"
              className="message-composer__send"
              aria-label="Надіслати"
              disabled={(
                (!comment.trim() && commentAttachmentIds.length === 0)
                || post.isPending
                || attachmentBusy
                || commentFileRemoval.pending
              )}
            >
              <Send size={20} />
            </button>
          )}
        />
        {commentFileRemoval.error && <div className="form-error" role="alert">{commentFileRemoval.error}</div>}
        {drivePickerOpen && (
          <DrivePicker
            onPick={(attachment) => attachFromDrive(attachment.id)}
            maxSelection={5 - commentAttachments.length}
            onClose={() => setDrivePickerOpen(false)}
          />
        )}
      </form>
    </section>
  )
}
