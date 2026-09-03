'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'

import { cn } from '@/lib/utils'

/**
 * Full-screen modal — the app's replacement for the old vaul slide-up
 * drawers (task form, task actions, rating, manual time, note taker).
 *
 * Why full-screen instead of a bottom sheet:
 *   • Position can never be wrong — the panel IS the viewport
 *     (`fixed inset-0` + `100dvh`), so iOS Safari's collapsing URL bar,
 *     safe areas and orientation changes can't clip or misplace it.
 *   • It can't jump mid-gesture — there is no drag transform to fight
 *     the virtual keyboard or viewport resize; open/close is a single
 *     cross-fade (no translate = nothing to reflow).
 *   • Scrolling is plain, natural document-style scrolling inside a
 *     flex column: pinned header, `flex-1 min-h-0` scrollable body,
 *     pinned footer with `env(safe-area-inset-bottom)` padding.
 *   • Focus trap, Esc-to-close, scroll lock and a11y roles come from
 *     Radix Dialog; sheets keep their own visible close buttons.
 *
 * Content should be laid out as: header (shrink-0) → body
 * (flex-1 min-h-0 overflow-y-auto overscroll-contain) → footer
 * (shrink-0). The five sheets already follow that structure.
 */
function FullScreenModal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="full-screen-modal" {...props} />
}

function ModalTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="modal-trigger" {...props} />
}

function ModalClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="modal-close" {...props} />
}

function ModalContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal data-slot="modal-portal">
      <DialogPrimitive.Overlay
        data-slot="modal-overlay"
        className={cn(
          // Dim layer, only visible for a split second while the fade
          // plays (the content covers it fully once settled).
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50'
        )}
      />
      <DialogPrimitive.Content
        data-slot="modal-content"
        className={cn(
          'bg-background fixed inset-0 z-50 flex h-[100dvh] w-full flex-col overflow-hidden',
          // Fade only — never translate/scale, so nothing can jump when
          // the keyboard or the browser chrome resizes the viewport.
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          className
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

function ModalHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="modal-header"
      className={cn('flex flex-col gap-0.5 p-4', className)}
      {...props}
    />
  )
}

function ModalFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="modal-footer"
      className={cn('mt-auto flex flex-col gap-2 p-4', className)}
      {...props}
    />
  )
}

function ModalTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="modal-title"
      className={cn('text-foreground font-semibold', className)}
      {...props}
    />
  )
}

function ModalDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="modal-description"
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  )
}

export {
  FullScreenModal,
  ModalTrigger,
  ModalClose,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalTitle,
  ModalDescription,
}
