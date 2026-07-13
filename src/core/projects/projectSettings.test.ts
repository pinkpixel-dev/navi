import { describe, expect, test } from "vitest";
import type { Conversation } from "../conversation/types";
import { defaultProjectName, projectColorOptions, projectIconOptions, mergeProjectSettings } from "./projectSettings";

function conversation(id: string, projectName: string): Conversation {
  return {
    id,
    title: id,
    projectName,
    provider: "Test",
    model: "test-model",
    processing: "external",
    isPinned: false,
    updatedAt: "2026-07-12T00:00:00.000Z",
    messages: [],
  };
}

describe("mergeProjectSettings", () => {
  test("keeps saved project metadata and adds projects found on conversations", () => {
    const projects = mergeProjectSettings(
      [
        {
          id: "pink-pixel",
          name: "PINK PIXEL",
          icon: "heart",
          color: "red",
          instructions: "Use Pink Pixel context.",
        },
      ],
      [conversation("a", "PINK PIXEL"), conversation("b", "Blog"), conversation("c", defaultProjectName)],
    );

    expect(projects).toEqual([
      {
        id: "pink-pixel",
        name: "PINK PIXEL",
        icon: "heart",
        color: "red",
        instructions: "Use Pink Pixel context.",
      },
      {
        id: "project-blog",
        name: "Blog",
        icon: "pen",
        color: "purple",
        instructions: "",
      },
    ]);
  });

  test("does not duplicate saved projects when conversation casing differs", () => {
    const projects = mergeProjectSettings(
      [{ id: "blog", name: "Blog", icon: "pen", color: "purple", instructions: "" }],
      [conversation("a", " blog ")],
    );

    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe("Blog");
  });
});

describe("project picker options", () => {
  test("includes the expanded icon and color choices", () => {
    expect(projectIconOptions.map((option) => option.value)).toEqual([
      "pen",
      "pencil",
      "heart",
      "star",
      "doc",
      "folder",
      "note",
      "briefcase",
      "palette",
      "spark",
      "box",
    ]);
    expect(projectColorOptions.map((option) => option.value)).toEqual([
      "red",
      "orange",
      "yellow",
      "green",
      "blue",
      "cyan",
      "purple",
      "pink",
      "black",
      "white",
    ]);
  });
});
