import type { FeedCommentView } from '@lankadws/contracts'
import {
  FeedCardDesign as SharedFeedCardDesign,
  type FeedCardModel as SharedFeedCardModel,
  type FeedCardViewState, type FeedMetadataPerson, type CardAction,
} from '../feed/FeedCardDesign'
import { ShowcaseCommentComposer, ShowcasePhotoPreviews } from './ShowcaseCommentComposer'
import type { ShowcasePhoto, ShowcasePhotoDraft } from './showcasePhotos'

export { FeedAcknowledgement, FeedFileRow, FeedMetadata, formatFeedFileSize } from '../feed/FeedCardDesign'
export type { CardAcknowledgement, AcknowledgementState, FeedCardViewState, FeedMetadataPerson, CardAction } from '../feed/FeedCardDesign'
export interface FeedCardModel extends SharedFeedCardModel {
  comments?: Array<FeedCommentView & { photos?: ShowcasePhoto[] }>
}

export function FeedCardDesign({ item, state, editorId, onAction, onBodyChange, onCommentChange, commentPhotos, onReply, onFile, onProfile }: {
  item: FeedCardModel
  state: FeedCardViewState
  editorId: string
  onProfile?: (person: FeedMetadataPerson) => void
  onAction: (action: CardAction) => void
  onBodyChange: (body: string) => void
  onCommentChange: (body: string) => void
  commentPhotos: ShowcasePhotoDraft
  onReply: (commentId: string) => void
  onFile: Parameters<typeof SharedFeedCardDesign>[0]['onFile']
}) {
  const reply = item.comments?.find((entry) => entry.id === state.replyTo)
  return <SharedFeedCardDesign item={item} state={state} editorId={editorId} onAction={onAction}
    onBodyChange={onBodyChange} onReply={onReply} onFile={onFile} onProfile={onProfile}
    renderCommentBody={(comment) => <p className="stream-comment-plain">{comment.body}</p>}
    renderCommentExtra={(comment) => {
      const photos = item.comments?.find((entry) => entry.id === comment.id)?.photos
      return photos?.length ? <ShowcasePhotoPreviews photos={photos} /> : null
    }}
    commentComposer={<ShowcaseCommentComposer id={editorId + '-comment'} value={state.comment}
      onChange={onCommentChange} photos={commentPhotos} sending={state.sending}
      reply={reply?.author.displayName} replyPreview={reply?.body}
      onCancelReply={() => onAction('cancel-reply')} onSend={() => onAction('send')} />}
  />
}
