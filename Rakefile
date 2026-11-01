# Rakefile -- Dwell
#
# `rake -T` lists every task. Ruby is only the task runner here; the work is
# done by node and wrangler (Cloudflare's CLI, a dev dependency: npm install).
#
# Deploys to https://dwell.literal.work/ on Cloudflare: the static app
# (dist/, built from an allowlist by tools/build-dist.mjs) behind a Worker
# (worker/index.js) with a D1 database (accounts, records, reading log) and a
# KV namespace (licensed Bible text, served only to owner accounts).
#
# First time: `npx wrangler login`, then `rake cf:setup`, the secrets (see
# `rake cf:secrets`), `rake cf:texts`, `rake deploy`. README.md has the walk
# through.

require "fileutils"
require "json"

PROJECT  = __dir__
SITE_URL = ENV["SITE"] || "https://dwell.literal.work/"   # SITE= points verify elsewhere
DB_NAME  = "dwell"
WRANGLER = File.join(PROJECT, "wrangler.toml")

def wrangler(*args, **opts)
  Dir.chdir(PROJECT) { sh("npx", "wrangler", *args, **opts) }
end

def wrangler_out(*args)
  Dir.chdir(PROJECT) { IO.popen(["npx", "wrangler", *args], err: [:child, :out], &:read) }
end

# Version ids from the generated lists, all or only licensed ones: js/versions.js
# (public, tracked) plus js/versions.local.js (licensed, gitignored, so their
# names stay out of the public repo) when it exists.
def version_lists = %w[js/versions.js js/versions.local.js].map { |f| File.join(PROJECT, f) }.select { |f| File.exist?(f) }.map { |f| File.read(f) }.join
def versions = version_lists.scan(/"id": "([a-z0-9]+)"/).flatten
def licensed = version_lists.scan(/"id": "([a-z0-9]+)"[^}]*"public": false/).flatten

task default: :check

# --------------------------------------------------------------------------
# Local
# --------------------------------------------------------------------------

desc "Check the JS and that every version has its text"
task :check do
  Dir.chdir(PROJECT) do
    js = Dir["sw.js", "js/**/*.js", "worker/**/*.js", "tools/*.mjs"].sort
    js.each { |f| sh "node", "--check", f }
    missing = versions.map { |id| "data/text/#{id}.json" }.reject { |f| File.exist?(f) }
    abort "Missing text files: #{missing.join(", ")} (rake text)" unless missing.empty?
    puts "#{js.size} JS files, and text for #{versions.join(", ")}: OK"
  end
end

desc "Build dist/: the files the Worker serves (an allowlist; public text only)"
task build: :check do
  Dir.chdir(PROJECT) { sh "node", "tools/build-dist.mjs" }
end

desc "Run locally at http://127.0.0.1:8787 with local D1/KV (first: rake dev:setup and a .dev.vars)"
task dev: :build do
  abort "No .dev.vars: see README.md (local development)." unless File.exist?(File.join(PROJECT, ".dev.vars"))
  wrangler "dev", "--port", "8787", "--ip", "127.0.0.1"
end

desc "Prepare the local database and texts for `rake dev`"
task "dev:setup" do
  wrangler "d1", "migrations", "apply", DB_NAME, "--local"
  licensed.each { |id| wrangler "kv", "key", "put", "text:#{id}", "--path", "data/text/#{id}.json", "--binding", "TEXT", "--local" }
end

# --------------------------------------------------------------------------
# Text
# --------------------------------------------------------------------------

BSB_ZIP = File.join(PROJECT, "versions", "engbsb_usfm.zip")
BSB_URL = "https://ebible.org/Scriptures/engbsb_usfm.zip"

file BSB_ZIP do
  FileUtils.mkdir_p(File.dirname(BSB_ZIP))
  sh "curl", "-fsSL", "-o", BSB_ZIP, BSB_URL
end

desc "Rebuild data/text/ and the version lists: the public text plus the licensed ones in versions/private.mjs"
task text: BSB_ZIP do
  # The licensed versions, their sources and their fixes are defined in
  # versions/private.mjs (gitignored). bsb is built first: some borrow its
  # paragraph layout.
  abort "No versions/private.mjs: `rake text:public` builds what a clone of the public repo has." unless File.exist?(File.join(PROJECT, "versions/private.mjs"))
  Dir.chdir(PROJECT) { sh "node", "tools/build-versions.mjs", "bsb=#{BSB_ZIP}", "--private" }
end

desc "Rebuild only the public text (BSB): all a clone of the public repo needs"
task "text:public" => BSB_ZIP do
  Dir.chdir(PROJECT) { sh "node", "tools/build-versions.mjs", "bsb=#{BSB_ZIP}" }
end

# --------------------------------------------------------------------------
# Cloudflare
# --------------------------------------------------------------------------

namespace :cf do
  desc "Create the D1 database and KV namespace (once), record their ids, apply migrations"
  task :setup do
    toml = File.read(WRANGLER)
    if toml.include?('database_id = "00000000-0000-0000-0000-000000000000"')
      out = wrangler_out("d1", "create", DB_NAME)
      id = out[/"?database_id"?\s*[=:]\s*"([0-9a-f-]{36})"/, 1] or abort "Couldn't create the D1 database:\n#{out}"
      toml.sub!("00000000-0000-0000-0000-000000000000", id)
      puts "D1 #{DB_NAME}: #{id}"
    end
    if toml.include?('id = "00000000000000000000000000000000"')
      out = wrangler_out("kv", "namespace", "create", "TEXT")
      id = out[/"?id"?\s*[=:]\s*"([0-9a-f]{32})"/, 1] or abort "Couldn't create the KV namespace:\n#{out}"
      toml.sub!("00000000000000000000000000000000", id)
      puts "KV TEXT: #{id}"
    end
    File.write(WRANGLER, toml)
    Rake::Task["cf:migrate"].invoke
  end

  desc "Apply database migrations to the live database"
  task :migrate do
    wrangler "d1", "migrations", "apply", DB_NAME, "--remote"
  end

  desc "Upload the licensed texts to KV (after `rake text` changes them)"
  task :texts do
    licensed.each { |id| wrangler "kv", "key", "put", "text:#{id}", "--path", "data/text/#{id}.json", "--binding", "TEXT", "--remote" }
  end

  desc "How to set the secrets (you type them; they never touch the repo)"
  task :secrets do
    puts <<~TXT

      Run each of these yourself; wrangler asks for the value:

        npx wrangler secret put OWNER_EMAILS   # accounts that may read every version (comma-separated)
        npx wrangler secret put SMTP_USER      # the DreamHost mailbox that sends, e.g. dwell@literal.work
        npx wrangler secret put SMTP_PASS      # that mailbox's password

      SMTP_HOST, SMTP_PORT and MAIL_FROM are plain settings in wrangler.toml.
    TXT
  end
end

desc "check + build + deploy + verify -- the normal way to ship"
task deploy: :build do
  wrangler "deploy"
  Rake::Task[:verify].invoke
end

desc "Probe the live site: public files open, licensed text and private paths shut (TOKEN=... also checks signed in)"
task :verify do
  require "net/http"
  require "uri"
  base = URI(SITE_URL)
  http = Net::HTTP.start(base.host, base.port, use_ssl: base.scheme == "https")
  get = ->(path, headers = {}) { http.request(Net::HTTP::Get.new(base.path + path, headers)) }
  failures = []
  expect = lambda do |label, res, codes|
    ok = Array(codes).include?(res.code.to_i)
    puts format("  %-36s %s %s", label, res.code, ok ? "ok" : "EXPECTED #{Array(codes).join("/")}")
    failures << label unless ok
  end

  expect.("app", get.(""), 200)
  expect.("manifest", get.("manifest.webmanifest"), 200)
  expect.("service worker", get.("sw.js"), 200)
  expect.("public text (bsb)", get.("text/bsb"), 200)
  licensed.each { |id| expect.("licensed text (#{id}), signed out", get.("text/#{id}"), 401) }
  expect.("api, signed out", get.("api/me"), 401)
  # Never part of dist/, so never served.
  probe = licensed.first || "bsb"
  { "text file by name" => "text/#{probe}.json", "licensed sources" => "versions/private.mjs", "backups" => "backups/",
    "worker source" => "worker/index.js", "wrangler.toml" => "wrangler.toml", ".dev.vars" => ".dev.vars",
    "tools" => "tools/build-dist.mjs", "raw text" => "data/text/#{probe}.json",
    "licensed list" => "js/versions.local.js" }.each do |label, path|
    expect.(label, get.(path), 404)
  end

  if (token = ENV["TOKEN"])
    auth = { "Authorization" => "Bearer #{token}" }
    res = get.("api/me", auth)
    expect.("api/me with TOKEN", res, 200)
    me = JSON.parse(res.body) rescue {}
    puts "  (#{me["email"]}: #{Array(me["versions"]).join(", ")})"
    licensed.each { |id| expect.("licensed text (#{id}) with TOKEN", get.("text/#{id}", auth), me["owner"] ? 200 : 403) }
  end
  http.finish
  abort "verify: #{failures.size} check(s) failed" unless failures.empty?
  puts "verify: OK"
end

desc "Print a sign-in token for EMAIL= without email (LOCAL=1 for rake dev). Run it yourself."
task :token do
  email = ENV["EMAIL"] or abort "EMAIL=you@example.com"
  Dir.chdir(PROJECT) { sh "node", "tools/token.mjs", email, *(ENV["LOCAL"] == "1" ? ["--local"] : []) }
end
