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

  test("Flask + htmx: fragment endpoints reached only by hx-* or form actions are not screens", async () => {
    await write("requirements.txt", "flask==3.1.2\n");
    await write(
      "views/videos.py",
      [
        "@blueprint.get('/videos/category/<cat_name>')",
        "def category(cat_name): ...",
        "@blueprint.get('/videos/add/<cat_name>')",
        "def add_get(cat_name): ...",
        "@blueprint.get('/videos/cancel_add/<cat_name>')",
        "def cancel_add(cat_name): ...",
        "@blueprint.get('/videos/search')",
        "def search(): ...",
      ].join("\n"),
    );
    await write(
      "templates/partials/show_add_form.html",
      '<a hx-get="/videos/add/{{ cat_name }}">add</a>',
    );
    await write(
      "templates/partials/add_form.html",
      '<form action="/videos/add/{{ cat_name }}" method="POST"><button hx-get="/videos/cancel_add/{{ cat_name }}">x</button></form>',
    );
    await write(
      "templates/layout.html",
      '<a href="/videos/search">search</a><input hx-get="/videos/search"><a href="/videos/category/{{ c.name }}">c</a>',
    );
    const result = await scanServerRoutes(root);
    expect(result?.routes.map((r) => r.routePath)).toEqual([
      "/videos/category/[cat_name]",
      "/videos/search",
    ]);
  });
});

describe("scanServerRoutes: Go", () => {
  const paths = async () => (await scanServerRoutes(root))?.routes.map((r) => r.routePath) ?? [];

  test("echo: groups handed to other packages' routers keep their prefixes", async () => {
    // pgbackweb's shape: web → dashboard → databases, each a package MountRouter.
    await write("go.mod", "module example.com/app\n");
    await write(
      "internal/view/web/router.go",
      `package web

func MountRouter(parent *echo.Group, mids *M) {
	parent.GET("", index)
	authGroup := parent.Group("/auth")
	auth.MountRouter(authGroup, mids)
	dashboardGroup := parent.Group("/dashboard", mids.RequireAuth)
	dashboard.MountRouter(dashboardGroup, mids)
}
`,
    );
    await write(
      "internal/view/web/auth/router.go",
      `package auth

func MountRouter(parent *echo.Group, mids *M) {
	noAuth := parent.Group("", mids.RequireNoAuth)
	noAuth.GET("/login", login)
	parent.POST("/logout", logout)
}
`,
    );
    await write(
      "internal/view/web/dashboard/router.go",
      `package dashboard

func MountRouter(
	parent *echo.Group, mids *M,
) {
	databases.MountRouter(parent.Group("/databases"), mids)
}
`,
    );
    await write(
      "internal/view/web/dashboard/databases/router.go",
      `package databases

func MountRouter(
	parent *echo.Group, mids *M,
) {
	parent.GET("", index)
	parent.GET("/:databaseID/edit", edit)
}
`,
    );
    expect((await scanServerRoutes(root))?.framework).toBe("go");
    expect(await paths()).toEqual([
      "/",
      "/auth/login",
      "/dashboard/databases",
      "/dashboard/databases/[databaseID]/edit",
    ]);
  });

  test("chi: nested Route closures, and a Go app's own /admin is kept", async () => {
    await write("go.mod", "module example.com/app\n");
    await write(
      "main.go",
      `package main

func routes(r chi.Router) {
	r.Get("/static/*", files)
	r.Route("/admin", func(r chi.Router) {
		r.Get("/", adminIndex)
		r.Route("/monitors", func(r chi.Router) {
			r.Get("/{id}", monitor)
		})
	})
	r.Get("/history", history)
}
`,
    );
    expect(await paths()).toEqual(["/admin", "/admin/monitors/[id]", "/history"]);
  });

  test("gin and net/http, ignoring look-alike Get calls and htmx fragments", async () => {
    await write("go.mod", "module example.com/app\n");
    await write(
      "cmd/server/main.go",
      `package main

func setupRoutes(router *gin.Engine) {
	router.GET("/subscriptions", list)
	router.GET("/form/subscription/:id", form)
	accept := c.Get("Accept")
	mux.HandleFunc("GET /calendar", calendar)
	mux.HandleFunc("POST /save", save)
}
`,
    );
    await write(
      "templates/list.html",
      '<a href="/subscriptions">All</a><button hx-get="/form/subscription/{{.ID}}">Edit</button>',
    );
    expect(await paths()).toEqual(["/calendar", "/subscriptions"]);
  });
});
