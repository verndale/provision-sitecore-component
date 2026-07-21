"use strict";

/**
 * Shared pure helpers. No I/O, no dependencies.
 */

/**
 * PascalCase → kebab-case with acronym handling.
 * "AwardCard" → "award-card", "CNPeopleCard" → "cn-people-card".
 */
function pascalToKebab(name) {
  return String(name || "")
    .replace(/([A-Z]+)([A-Z][a-z0-9])/g, "$1-$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
}

/** True when the value is a plain object (not array/null). */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** POSIX-join path segments without resolving against the filesystem. */
function joinItemPath(root, name) {
  return `${String(root).replace(/\/+$/, "")}/${name}`;
}

module.exports = { pascalToKebab, isPlainObject, joinItemPath };
