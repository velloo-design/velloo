import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { scanServerRoutes } from "../server-routes.ts";

let root: string;

async function write(rel: string, content: string): Promise<void> {
  const file = join(root, rel);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
}

beforeEach(async () => {
  root = join(tmpdir(), `velloo-server-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(root, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("scanServerRoutes", () => {
  test("returns null when nothing recognizable is present", async () => {
    await write("README.md", "hello");
    expect(await scanServerRoutes(root)).toBeNull();
  });

  test("Django: root urlconf paths, app urls prefixed, admin/include skipped", async () => {
    await write("manage.py", "");
    await write(
      "mysite/settings.py",
      "INSTALLED_APPS = []\n", // marks mysite/ as the project package
    );
    await write(
      "mysite/urls.py",
      [
        "from django.urls import include, path",
        "urlpatterns = [",
        '    path("admin/", admin.site.urls),',
        '    path("", views.home),',
        '    path("about/", views.about),',
        '    path("blog/", include("blog.urls")),',
        "]",
      ].join("\n"),
    );
    await write(
      "blog/urls.py",
      [
        "from django.urls import path",
        "urlpatterns = [",
        '    path("", views.index),',
        '    path("<slug:slug>/", views.detail),',
        "]",
      ].join("\n"),
    );
    const result = await scanServerRoutes(root);
    expect(result?.framework).toBe("django");
    expect(result?.routes.map((r) => r.routePath).sort()).toEqual([
      "/",
      "/about",
      "/blog",
      "/blog/[slug]",
    ]);
  });

  test("Flask/FastAPI: GET decorators found, non-GET and /api skipped", async () => {
    await write("requirements.txt", "flask==3.0\n");
    await write(
      "app.py",
      [
        "from flask import Flask",
        "app = Flask(__name__)",
        '@app.route("/")',
        "def home(): ...",
        '@app.route("/items/<int:item_id>")',
        "def item(item_id): ...",
        '@app.route("/submit", methods=["POST"])',
        "def submit(): ...",
        '@app.get("/pricing")',
        "def pricing(): ...",
        '@app.route("/api/things")',
        "def things(): ...",
      ].join("\n"),
    );
    const result = await scanServerRoutes(root);
    expect(result?.framework).toBe("flask");
    expect(result?.routes.map((r) => r.routePath).sort()).toEqual([
      "/",
      "/items/[item_id]",
      "/pricing",
    ]);
  });

  test("Rails: root, get, and resources (index + show)", async () => {
    await write(
      "config/routes.rb",
      [
        "Rails.application.routes.draw do",
        '  root "pages#home"',
        '  get "about", to: "pages#about"',
        "  resources :posts",
        "  resource :profile",
        "end",
      ].join("\n"),
    );
    const result = await scanServerRoutes(root);
    expect(result?.framework).toBe("rails");
    expect(result?.routes.map((r) => r.routePath).sort()).toEqual([
      "/",
      "/about",
      "/posts",
      "/posts/[id]",
      "/profile",
    ]);
  });

  test("Laravel: Route::get / Route::view in routes/web.php", async () => {
    await write("artisan", "");
    await write(
      "routes/web.php",
      [
        "<?php",
        "Route::get('/', function () { return view('welcome'); });",
        "Route::get('/users/{id}', [UserController::class, 'show']);",
        "Route::view('/terms', 'terms');",
        "Route::post('/contact', [ContactController::class, 'send']);",
      ].join("\n"),
    );
    const result = await scanServerRoutes(root);
    expect(result?.framework).toBe("laravel");
    expect(result?.routes.map((r) => r.routePath).sort()).toEqual(["/", "/terms", "/users/[id]"]);
  });
});
