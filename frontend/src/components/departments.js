/**
 * Departments come from the shop's settings (config.departments, a list of
 * { name, colour, icon }) instead of three tables keyed on Bayan's
 * "Women / Men / Kids / Accessories". An unlisted category gets a generic tag
 * icon and the theme's primary colour — never a fashion-specific guess like
 * the perfume bottle every unknown category used to inherit.
 *
 * The icon names are the contract with backend/src/settings.js
 * (DEPARTMENT_ICONS); the SVG paths live here, drawn on a 100×100 grid.
 */
import { useConfig } from "../store";
import { shade, isHex } from "../theme";

export const DEPARTMENT_ICON_PATHS = {
  tag: "M30 30h26l18 18-26 26-18-18zM40 38a4 4 0 100 8 4 4 0 000-8z",
  dress: "M50 22c-6 0-10 5-10 11 0 4 2 7 4 9L30 78h40L56 42c2-2 4-5 4-9 0-6-4-11-10-11z",
  shirt: "M32 30l12-8h12l12 8 6 28h-10l-2 22H38l-2-22H26z",
  child: "M50 20a9 9 0 100 18 9 9 0 000-18zM34 44l16-4 16 4 4 20h-8l-2 16H40l-2-16h-8z",
  bottle: "M44 20h12v8h-12zM40 30h20a6 6 0 016 6v36a6 6 0 01-6 6H40a6 6 0 01-6-6V36a6 6 0 016-6zM42 44h16v10H42z",
  bag: "M32 40h36l-4 38H36zM42 40v-6a8 8 0 0116 0v6h-4v-6a4 4 0 00-8 0v6z",
  shoe: "M24 58l6-22h10l4 10c6 4 16 6 26 8a6 6 0 016 6v6H24z",
  ring: "M50 36a18 18 0 110 36 18 18 0 010-36zm0 6a12 12 0 100 24 12 12 0 000-24zM44 22h12l4 8H40z",
  home: "M50 22l30 26h-8v30H58V60H42v18H28V48h-8z",
};

/** The department entry for a category name (case-insensitive), or null. */
export function findDepartment(departments, name) {
  const key = String(name || "").toLowerCase();
  return (departments || []).find((d) => d.name.toLowerCase() === key) || null;
}

/** Icon path for a category, falling back to the generic tag. */
export function departmentIcon(departments, name) {
  const d = findDepartment(departments, name);
  return DEPARTMENT_ICON_PATHS[d?.icon] || DEPARTMENT_ICON_PATHS.tag;
}

/** Card background for a category: its colour as a gradient, or the theme primary. */
export function departmentBackground(departments, name) {
  const colour = findDepartment(departments, name)?.colour;
  return isHex(colour)
    ? `linear-gradient(135deg, ${colour}, ${shade(colour, 30)})`
    : "linear-gradient(135deg, var(--pine-dark), var(--pine))";
}

/** The configured departments, in the owner's order. */
export const useDepartments = () => useConfig().departments || [];
