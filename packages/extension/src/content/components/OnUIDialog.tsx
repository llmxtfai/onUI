import { useState, useCallback, useEffect, useRef } from 'preact/hooks';
import type { AnnotationIntent, AnnotationSeverity } from '@/types';
import { getComputedStylesInfo, type ComputedStylesInfo } from '../utils/computed-styles';
import { getReactComponents } from '../utils/react-detection';
import { getCssSelector, getElementPath } from '../utils/element-path';
import { useViewportTick } from '../hooks/useViewportTick';
import { OnUIAnnotationFormDialog } from './OnUIAnnotationForm';

// Icons
const TargetRemoveIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const ReactIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
    <circle cx="12" cy="12" r="2" />
    <ellipse cx="12" cy="12" rx="10" ry="4" />
    <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)" />
    <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)" />
  </svg>
);

interface OnUISaveData {
  comment: string;
  intent?: AnnotationIntent | undefined;
  severity?: AnnotationSeverity | undefined;
}

interface OnUIDialogProps {
  element: Element;
  onSave: (data: OnUISaveData) => void | Promise<void>;
  onComplete?: ((data: OnUISaveData) => void | Promise<void>) | undefined;
  onCancel: () => void;
  initialComment?: string;
  initialIntent?: AnnotationIntent | undefined;
  initialSeverity?: AnnotationSeverity | undefined;
  isEditing?: boolean;
  onDelete?: () => void;
  multiTargets?: Element[] | undefined;
  onRemoveTarget?: ((target: Element) => void) | undefined;
}

export function OnUIDialog({
  element,
  onSave,
  onComplete,
  onCancel,
  initialComment = '',
  initialIntent,
  initialSeverity,
  isEditing = false,
  onDelete,
  multiTargets,
  onRemoveTarget,
}: OnUIDialogProps) {
  const tick = useViewportTick();
  const [comment, setComment] = useState(initialComment);
  const defaultIntent =
    initialIntent !== undefined || isEditing ? initialIntent : 'change';
  const [intent, setIntent] = useState<AnnotationIntent | undefined>(defaultIntent);
  const [severity, setSeverity] = useState<AnnotationSeverity | undefined>(initialSeverity);
  const [activeSubmitAction, setActiveSubmitAction] = useState<'save' | 'complete' | null>(null);
  const [stylesInfo, setStylesInfo] = useState<ComputedStylesInfo | null>(null);
  const [reactPath, setReactPath] = useState<string | null>(null);
  const [showStyles, setShowStyles] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const isMultiCreate = !isEditing && multiTargets !== undefined;
  const targetCount = multiTargets?.length ?? 1;
  const hasTargets = targetCount > 0;
  const canSave = Boolean(comment.trim()) && (!isMultiCreate || hasTargets);
  const canComplete = !isEditing && onComplete !== undefined && canSave;
  const isSubmitting = activeSubmitAction !== null;

  // Store current values in refs for stable keydown handler
  const commentRef = useRef(comment);
  const intentRef = useRef(intent);
  const severityRef = useRef(severity);
  const isSubmittingRef = useRef(isSubmitting);

  // Keep refs up to date when state changes
  useEffect(() => {
    commentRef.current = comment;
  }, [comment]);

  useEffect(() => {
    intentRef.current = intent;
  }, [intent]);

  useEffect(() => {
    severityRef.current = severity;
  }, [severity]);

  useEffect(() => {
    isSubmittingRef.current = isSubmitting;
  }, [isSubmitting]);

  const runSubmit = useCallback(
    async (
      action: 'save' | 'complete',
      commentValue: string,
      intentValue: AnnotationIntent | undefined,
      severityValue: AnnotationSeverity | undefined
    ) => {
      if (isSubmittingRef.current) {
        return;
      }

      const actionHandler = action === 'complete' ? onComplete : onSave;
      if (!actionHandler) {
        return;
      }

      setActiveSubmitAction(action);
      isSubmittingRef.current = true;

      try {
        await Promise.resolve(
          actionHandler({
            comment: commentValue,
            intent: intentValue,
            severity: severityValue,
          })
        );
      } finally {
        isSubmittingRef.current = false;
        setActiveSubmitAction(null);
      }
    },
    [onComplete, onSave]
  );

  const handleSave = useCallback(() => {
    if (!canSave) {
      return;
    }

    void runSubmit('save', comment, intent, severity);
  }, [canSave, comment, intent, severity, runSubmit]);

  const handleComplete = useCallback(() => {
    if (!canComplete) {
      return;
    }

    void runSubmit('complete', comment, intent, severity);
  }, [canComplete, comment, intent, severity, runSubmit]);

  // Extract element info on mount
  useEffect(() => {
    if (isMultiCreate) {
      setStylesInfo(null);
      setReactPath(null);
    } else {
      setStylesInfo(getComputedStylesInfo(element));
      setReactPath(getReactComponents(element));
    }

    // Focus textarea
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 100);
  }, [element, isMultiCreate]);

  // Position dialog near element
  useEffect(() => {
    if (!dialogRef.current) return;

    const rect = element.getBoundingClientRect();
    const dialog = dialogRef.current;
    const dialogRect = dialog.getBoundingClientRect();

    // Position to the right of element, or left if not enough space
    let left = rect.left + rect.width + 16;
    let top = rect.top;

    // Check if dialog goes off right edge
    if (left + dialogRect.width > window.innerWidth - 20) {
      left = rect.left - dialogRect.width - 16;
    }

    // Check if dialog goes off left edge
    if (left < 20) {
      left = 20;
    }

    // Check if dialog goes off bottom
    if (top + dialogRect.height > window.innerHeight - 20) {
      top = window.innerHeight - dialogRect.height - 20;
    }

    // Check if dialog goes off top
    if (top < 20) {
      top = 20;
    }

    dialog.style.left = `${left}px`;
    dialog.style.top = `${top}px`;
  }, [element, tick]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        const shouldSave = Boolean(commentRef.current.trim()) && (!isMultiCreate || hasTargets);
        if (!shouldSave || isSubmittingRef.current) {
          return;
        }

        void runSubmit('save', commentRef.current, intentRef.current, severityRef.current);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel, runSubmit, isMultiCreate, hasTargets]);

  const elementPath = getElementPath(element);
  const selector = getCssSelector(element);
  const title = isEditing
    ? 'Edit Annotation'
    : isMultiCreate
      ? `Add ${targetCount} Annotation${targetCount === 1 ? '' : 's'}`
      : 'Add Annotation';
  const subtitle = isMultiCreate ? `${targetCount} selected elements` : elementPath;
  const saveLabel = isEditing
    ? 'Update'
    : isMultiCreate
      ? `Add ${targetCount} Annotation${targetCount === 1 ? '' : 's'}`
      : 'Add Annotation';
  const saveButtonLabel =
    activeSubmitAction === 'save' ? (isEditing ? 'Updating...' : 'Saving...') : saveLabel;
  const completeButtonLabel = activeSubmitAction === 'complete' ? 'Completing...' : 'Complete';

  return (
    <OnUIAnnotationFormDialog
      title={title}
      subtitle={subtitle}
      subtitleTitle={selector}
      closeButtonLabel="Close annotation dialog"
      onCancel={onCancel}
      showBackdrop
      dialogRef={dialogRef}
      comment={comment}
      intent={intent}
      severity={severity}
      onCommentChange={setComment}
      onIntentChange={setIntent}
      onSeverityChange={setSeverity}
      onSave={handleSave}
      {...(isEditing && onDelete ? { onDelete } : {})}
      {...(!isEditing && onComplete
        ? {
            onSecondaryAction: handleComplete,
            secondaryActionLabel: completeButtonLabel,
            secondaryActionTitle: 'Add annotation, then copy, clear, and exit capture mode',
            secondaryActionDisabled: !canComplete || isSubmitting,
          }
        : {})}
      commentPlaceholder="Describe the issue or feedback..."
      saveLabel={saveButtonLabel}
      saveDisabled={!canSave || isSubmitting}
      isSaving={activeSubmitAction === 'save'}
      textareaRef={textareaRef}
    >
      {isMultiCreate && (
        <div class="onui-targets">
          <div class="onui-targets-title">Selected Targets</div>
          {multiTargets && multiTargets.length > 0 ? (
            <ul class="onui-target-list">
              {multiTargets.map((target, index) => {
                const targetPath = getElementPath(target);
                const targetSelector = getCssSelector(target);

                return (
                  <li class="onui-target-item" key={`${targetSelector}-${index}`}>
                    <div class="onui-target-content">
                      <div class="onui-target-path" title={targetSelector}>
                        {targetPath}
                      </div>
                      <div class="onui-target-selector" title={targetSelector}>
                        {targetSelector}
                      </div>
                    </div>
                    {onRemoveTarget && (
                      <button
                        class="onui-target-remove"
                        aria-label={`Remove target ${index + 1}`}
                        title={`Remove target ${index + 1}`}
                        onClick={() => onRemoveTarget(target)}
                      >
                        <TargetRemoveIcon />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div class="onui-target-empty">No targets selected.</div>
          )}
        </div>
      )}

      {/* React Component Path */}
      {!isMultiCreate && reactPath && (
        <div class="onui-component-path">
          <ReactIcon />
          <span>{reactPath}</span>
        </div>
      )}

      {/* Computed styles are only shown for single-element mode */}
      {!isMultiCreate && (
        <>
          <button
            class="onui-btn"
            onClick={() => setShowStyles(!showStyles)}
            style={{ marginTop: '12px' }}
          >
            {showStyles ? 'Hide Styles' : 'Show Computed Styles'}
          </button>

          {showStyles && stylesInfo && (
            <div class="onui-styles">
              <div class="onui-styles-title">Layout</div>
              {Object.entries(stylesInfo.layout).map(([key, value]) => (
                <div class="onui-style-row" key={key}>
                  <span class="onui-style-key">{key}</span>
                  <span class="onui-style-value">{value}</span>
                </div>
              ))}

              <div class="onui-styles-title" style={{ marginTop: '12px' }}>
                Typography
              </div>
              {Object.entries(stylesInfo.typography).map(([key, value]) => (
                <div class="onui-style-row" key={key}>
                  <span class="onui-style-key">{key}</span>
                  <span class="onui-style-value">{value}</span>
                </div>
              ))}

              <div class="onui-styles-title" style={{ marginTop: '12px' }}>
                Colors
              </div>
              {Object.entries(stylesInfo.colors).map(([key, value]) => (
                <div class="onui-style-row" key={key}>
                  <span class="onui-style-key">{key}</span>
                  <span class="onui-style-value">{value}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </OnUIAnnotationFormDialog>
  );
}
