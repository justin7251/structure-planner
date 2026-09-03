'use client';

import { useState } from 'react';
import { DoorOpen } from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore } from '@/store/use-app-store';
import { useAuthStore } from '@/store/use-auth-store';
import { signOutGoogleUser } from '@/lib/firebase/auth';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

/**
 * The way back out of the app — every mode gets an obvious exit to the
 * landing/start page (fixes "entered the app and got stuck there").
 *
 *  - signed-out (demo / local mode): leaves directly; data stays on the
 *    device and "Try the live demo" brings you back.
 *  - signed-in: the app gate keeps signed-in users inside the app, so the
 *    only honest exit is signing out — we confirm before ending the session
 *    (cloud data is untouched; signing back in restores it).
 */
export function ExitToLandingButton({
  variant = 'pill',
  testid = 'exit-to-landing',
  className,
}: {
  variant?: 'pill' | 'icon';
  testid?: string;
  className?: string;
}) {
  const signedIn = useAuthStore((s) => s.status === 'signedIn');
  const [busy, setBusy] = useState(false);

  const leave = async () => {
    if (signedIn) {
      setBusy(true);
      try {
        await signOutGoogleUser();
      } catch {
        // Firebase sign-out failed (offline?) — still exit locally; the
        // cached session resumes on the next load, nothing is lost.
      }
      setBusy(false);
    }
    useAppStore.getState().exitToLanding();
    toast(signedIn ? 'Signed out — back to the start page' : 'Back to the start page', {
      description: signedIn
        ? 'Your tasks are safe in the cloud — sign in again to get them back.'
        : 'Your data stays on this device — tap "Try the live demo" to come back.',
      duration: 6000,
    });
  };

  const trigger = (
    <button
      type="button"
      onClick={signedIn ? undefined : leave}
      disabled={busy}
      aria-label="Back to start page"
      title="Back to start page"
      data-testid={testid}
      className={cn(
        'grid shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95 disabled:opacity-60',
        variant === 'pill'
          ? 'h-9 gap-1.5 rounded-full border border-border bg-card px-3.5 text-xs font-semibold hover:bg-muted'
          : 'size-9',
        className,
      )}
    >
      {busy ? (
        <span className="size-3.5 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-muted-foreground" aria-hidden />
      ) : (
        <DoorOpen className={variant === 'pill' ? 'size-3.5' : 'size-[18px]'} aria-hidden />
      )}
      {variant === 'pill' && 'Back to start'}
    </button>
  );

  if (!signedIn) return trigger;

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent className="max-w-sm rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>Sign out and go back?</AlertDialogTitle>
          <AlertDialogDescription>
            You are signed in, so going back to the start page ends your session on this device.
            Your tasks stay safe in the cloud — sign in again anytime to get them back.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="rounded-xl">Stay</AlertDialogCancel>
          <AlertDialogAction
            className="rounded-xl"
            data-testid="exit-confirm"
            onClick={leave}
          >
            Sign out &amp; go back
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
