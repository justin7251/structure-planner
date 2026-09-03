import {
  AlarmClock,
  Bike,
  BookOpen,
  Briefcase,
  Car,
  Clapperboard,
  CodeXml,
  Coffee,
  Dog,
  Dumbbell,
  Gamepad2,
  GraduationCap,
  Headphones,
  Heart,
  Home,
  Languages,
  Laptop,
  Leaf,
  Mail,
  Moon,
  Music,
  PenLine,
  Phone,
  Pill,
  ShoppingBag,
  Sparkles,
  Sun,
  TreePalm,
  Utensils,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { TaskColor } from '@/types';

/**
 * Structured-style per-task styling: a pastel block color + a glyph.
 * Colors are plain hex so they can be composed with alpha for soft
 * timeline blocks and dots (inline styles), while text colors keep
 * light/dark Tailwind variants for contrast.
 */
export interface TaskColorMeta {
  key: TaskColor;
  label: string;
  /** Base hex — blocks/dots/icons derive from this with alpha. */
  hex: string;
  /** Readable text shade for light / dark surfaces. */
  text: { light: string; dark: string };
}

export const TASK_COLORS: Record<TaskColor, TaskColorMeta> = {
  coral: { key: 'coral', label: 'Coral', hex: '#ee8172', text: { light: 'text-[#c14f3f]', dark: 'dark:text-[#f5a899]' } },
  orange: { key: 'orange', label: 'Orange', hex: '#f09a54', text: { light: 'text-[#b5651d]', dark: 'dark:text-[#f5be8a]' } },
  yellow: { key: 'yellow', label: 'Yellow', hex: '#eec94c', text: { light: 'text-[#96760f]', dark: 'dark:text-[#edd488]' } },
  green: { key: 'green', label: 'Green', hex: '#7dc57d', text: { light: 'text-[#3d7f46]', dark: 'dark:text-[#a8dca8]' } },
  teal: { key: 'teal', label: 'Teal', hex: '#5fbfb0', text: { light: 'text-[#257a6d]', dark: 'dark:text-[#93ded1]' } },
  blue: { key: 'blue', label: 'Blue', hex: '#6e96b8', text: { light: 'text-[#3f6a8d]', dark: 'dark:text-[#a5c4de]' } },
  purple: { key: 'purple', label: 'Purple', hex: '#9c8bd9', text: { light: 'text-[#6a59b8]', dark: 'dark:text-[#bcaff0]' } },
  pink: { key: 'pink', label: 'Pink', hex: '#e58bb4', text: { light: 'text-[#b04a7d]', dark: 'dark:text-[#f0b4ce]' } },
  slate: { key: 'slate', label: 'Slate', hex: '#98a2ad', text: { light: 'text-[#5b6773]', dark: 'dark:text-[#b6c0cb]' } },
};

export const TASK_COLOR_ORDER: TaskColor[] = [
  'coral',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'purple',
  'pink',
  'slate',
];

/** Base hex composited with a 2-digit alpha suffix (e.g. '14' ≈ 8%). */
export function colorWithAlpha(hex: string, alpha: string): string {
  return `${hex}${alpha}`;
}

export function taskColorMeta(color: TaskColor | string | null | undefined): TaskColorMeta {
  return (color && TASK_COLORS[color as TaskColor]) || TASK_COLORS.slate;
}

/** Tailwind text classes that stay readable in both themes. */
export function taskTextClass(color: TaskColor | string | null | undefined): string {
  const meta = taskColorMeta(color);
  return `${meta.text.light} ${meta.text.dark}`;
}

export interface TaskIconMeta {
  key: string;
  label: string;
  Icon: LucideIcon;
}

const icon = (key: string, Icon: LucideIcon, label: string): TaskIconMeta => ({ key, Icon, label });

/** Curated glyph set for tasks — covers the common daily-planner verbs. */
export const TASK_ICONS: TaskIconMeta[] = [
  icon('alarm', AlarmClock, 'Alarm'),
  icon('sparkles', Sparkles, 'Sparkles'),
  icon('laptop', Laptop, 'Work'),
  icon('briefcase', Briefcase, 'Meeting'),
  icon('pen', PenLine, 'Write'),
  icon('code', CodeXml, 'Code'),
  icon('mail', Mail, 'Email'),
  icon('phone', Phone, 'Call'),
  icon('book', BookOpen, 'Read'),
  icon('graduation', GraduationCap, 'Study'),
  icon('languages', Languages, 'Language'),
  icon('dumbbell', Dumbbell, 'Workout'),
  icon('bike', Bike, 'Ride'),
  icon('leaf', Leaf, 'Wellness'),
  icon('sun', Sun, 'Outdoors'),
  icon('tree', TreePalm, 'Vacation'),
  icon('coffee', Coffee, 'Break'),
  icon('utensils', Utensils, 'Meal'),
  icon('music', Music, 'Music'),
  icon('headphones', Headphones, 'Listen'),
  icon('clapperboard', Clapperboard, 'Watch'),
  icon('gamepad', Gamepad2, 'Play'),
  icon('heart', Heart, 'Care'),
  icon('moon', Moon, 'Sleep'),
  icon('shopping', ShoppingBag, 'Shop'),
  icon('home', Home, 'Home'),
  icon('wrench', Wrench, 'Fix'),
  icon('pill', Pill, 'Health'),
  icon('dog', Dog, 'Pet'),
  icon('car', Car, 'Drive'),
];

export function iconMeta(key: string | null | undefined): TaskIconMeta {
  return TASK_ICONS.find((i) => i.key === key) ?? TASK_ICONS[0];
}

/** Rotating defaults so consecutive quick-adds don't all look the same. */
export function defaultColorForIndex(i: number): TaskColor {
  return TASK_COLOR_ORDER[i % TASK_COLOR_ORDER.length];
}

export function defaultIconForIndex(i: number): string {
  return TASK_ICONS[i % TASK_ICONS.length].key;
}
