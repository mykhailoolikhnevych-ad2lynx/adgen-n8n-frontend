import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { saveFeedback, type FeedbackRating, type FeedbackTab } from '@/lib/feedback';

export interface FeedbackContext {
  feedbackId: string;
  tab: FeedbackTab;
  operation: string;
  model: string;
  promptSource: string;
  promptText: string;
  input: Record<string, unknown>;
  inputImage?: string;
  outputImage: string;
}

// Per-image like/dislike widget. 👍 saves immediately. 👎 marks active and
// opens an inline box for an optional comment (Submit saves, Cancel reverts
// with nothing saved). Switching vote later is allowed; switching to like
// clears any stored comment. Failures show small inline text — never blocks
// the page.
export const FeedbackButtons = ({ ctx, className = '' }: { ctx: FeedbackContext; className?: string }) => {
  const [rating, setRating] = useState<FeedbackRating | null>(null);
  const [comment, setComment] = useState('');
  const [showBox, setShowBox] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const persist = async (r: FeedbackRating, c: string) => {
    setSaving(true);
    setError(null);
    const ok = await saveFeedback({
      feedback_id: ctx.feedbackId,
      tab: ctx.tab,
      operation: ctx.operation,
      model: ctx.model,
      prompt_source: ctx.promptSource,
      prompt_text: ctx.promptText,
      input: ctx.input,
      input_image: ctx.inputImage,
      output_image: ctx.outputImage,
      rating: r,
      comment: c,
    });
    setSaving(false);
    if (ok) {
      setRating(r);
      setComment(c);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1500);
    } else {
      setError("Couldn't save — try again");
    }
  };

  const clickLike = () => {
    setShowBox(false);
    void persist('like', '');
  };

  const clickDislike = () => {
    setShowBox(true);
  };

  const submitDislike = () => {
    setShowBox(false);
    void persist('dislike', comment);
  };

  const cancelDislike = () => {
    setShowBox(false);
    setComment(rating === 'dislike' ? comment : '');
  };

  const btnBase = 'inline-flex items-center justify-center rounded-md border px-2 py-1 text-xs leading-none transition-colors disabled:opacity-50';
  const activeCls = 'border-slate-500 bg-slate-100';
  const idleCls = 'border-slate-300 bg-white hover:bg-slate-50';

  return (
    <div className={className}>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={clickLike}
          disabled={saving}
          title="Like"
          aria-pressed={rating === 'like'}
          className={`${btnBase} ${rating === 'like' ? activeCls : idleCls}`}
        >
          👍
        </button>
        <button
          type="button"
          onClick={clickDislike}
          disabled={saving}
          title="Dislike"
          aria-pressed={rating === 'dislike' || showBox}
          className={`${btnBase} ${rating === 'dislike' || showBox ? activeCls : idleCls}`}
        >
          👎
        </button>
        {justSaved && <span className="text-[10px] text-green-600">Thanks</span>}
        {error && <span className="text-[10px] text-red-600">{error}</span>}
      </div>

      {showBox && (
        <div className="mt-1.5 w-full rounded-md border border-slate-200 bg-white p-2 shadow-sm">
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What didn't you like? (optional)"
            rows={2}
            className="text-[11px]"
          />
          <div className="mt-1.5 flex justify-end gap-1">
            <Button type="button" size="xs" variant="ghost" onClick={cancelDislike}>
              Cancel
            </Button>
            <Button type="button" size="xs" onClick={submitDislike} disabled={saving}>
              {saving ? 'Saving…' : 'Submit'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
