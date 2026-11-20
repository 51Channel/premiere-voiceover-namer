// 赫朝录音改名：Premiere 这一侧（ExtendScript，ES3）。
// 只做三件事：报告工程状态、列出素材、把素材换到新文件并改名。文件的复制、改名、删除都在面板（Node）里做。
// 结果一律返回 JSON 字符串；ExtendScript 不一定有 JSON，自己拼，非 ASCII 转成 \uXXXX。

var VN_ITEMS = {};

function vnJson(value) {
    if (value === null || value === undefined) return "null";
    var type = typeof value;
    if (type === "number") return isFinite(value) ? String(value) : "null";
    if (type === "boolean") return value ? "true" : "false";
    if (type === "string") {
        var out = '"';
        for (var i = 0; i < value.length; i++) {
            var code = value.charCodeAt(i);
            var c = value.charAt(i);
            if (c === '"' || c === "\\") out += "\\" + c;
            else if (code < 0x20 || code > 0x7e) out += "\\u" + ("0000" + code.toString(16)).slice(-4);
            else out += c;
        }
        return out + '"';
    }
    var parts = [];
    if (value instanceof Array) {
        for (var k = 0; k < value.length; k++) parts.push(vnJson(value[k]));
        return "[" + parts.join(",") + "]";
    }
    for (var key in value) {
        if (value.hasOwnProperty(key) && typeof value[key] !== "function") parts.push(vnJson(String(key)) + ":" + vnJson(value[key]));
    }
    return "{" + parts.join(",") + "}";
}

function vnType(name, fallback) {
    try {
        if (typeof ProjectItemType !== "undefined" && ProjectItemType[name] !== undefined) return ProjectItemType[name];
    } catch (e) {}
    return fallback;
}

function vnPathKey(p) {
    var s = String(p || "").replace(/\\/g, "/");
    if (/^[a-zA-Z]:\//.test(s) || s.indexOf("//") === 0) s = s.toLowerCase();
    return s;
}

function vnClipCount(seq) {
    var n = 0;
    try {
        for (var i = 0; i < seq.audioTracks.numTracks; i++) n += seq.audioTracks[i].clips.numItems;
    } catch (e) {}
    return n;
}

// 工程状态。sig 变了才需要重新列素材（新录音会让根素材箱或音轨上的片段数变化）。
function vnStatus() {
    try {
        var p = app.project;
        if (!p) return vnJson({ ok: true, open: false });
        var path = String(p.path || "");
        var saved = /\.prproj$/i.test(path);
        if (saved) {
            try { saved = new File(path).exists; } catch (e1) {}
        }
        var seq = p.activeSequence;
        var seqCount = 0;
        try { seqCount = p.sequences.numSequences; } catch (e2) {}
        var sig = [p.rootItem.children.numItems, seqCount, seq ? seq.sequenceID : "", seq ? vnClipCount(seq) : 0].join("|");
        return vnJson({
            ok: true,
            open: true,
            saved: saved,
            name: String(p.name || ""),
            path: path,
            sequence: seq ? String(seq.name) : "",
            sig: sig,
            version: String(app.version || "")
        });
    } catch (e) {
        return vnJson({ ok: false, error: String(e) });
    }
}

function vnWalk(item, out, bin) {
    var kids = item.children;
    if (!kids) return;
    var BIN = vnType("BIN", 2);
    for (var i = 0; i < kids.numItems; i++) {
        var c = kids[i];
        if (!c) continue;
        if (c.type === BIN) {
            vnWalk(c, out, bin ? bin + " / " + c.name : String(c.name));
            continue;
        }
        try { if (c.isSequence && c.isSequence()) continue; } catch (e0) {}
        var mp = "";
        try { mp = String(c.getMediaPath() || ""); } catch (e1) {}
        if (!mp) continue;
        VN_ITEMS[c.nodeId] = c;
        out.push({ id: String(c.nodeId), name: String(c.name), path: mp, bin: bin || "" });
    }
}

// 列出工程里所有带文件的素材（跳过素材箱、序列、字幕之类）
function vnListMedia() {
    try {
        VN_ITEMS = {};
        var out = [];
        vnWalk(app.project.rootItem, out, "");
        return vnJson({ ok: true, items: out });
    } catch (e) {
        return vnJson({ ok: false, error: String(e) });
    }
}

function vnFind(id) {
    if (VN_ITEMS[id]) return VN_ITEMS[id];
    var out = [];
    VN_ITEMS = {};
    vnWalk(app.project.rootItem, out, "");
    return VN_ITEMS[id] || null;
}

// 把一组素材（同一个文件）换到新文件。
// newName 不为空就把素材名改成它；renameClips 为 "1" 时，所有序列里用到这些素材的片段也改成这个名字。
function vnRelink(idList, newPath, newName, renameClips) {
    var result = { ok: true, relinked: 0, clips: 0, errors: [] };
    try {
        var ids = String(idList).split(",");
        var want = vnPathKey(newPath);
        var touched = {};
        for (var i = 0; i < ids.length; i++) {
            var item = vnFind(ids[i]);
            if (!item) {
                result.errors.push("工程里找不到这条素材了");
                continue;
            }
            try {
                if (item.canChangeMediaPath && !item.canChangeMediaPath()) {
                    result.errors.push("这条素材不能换文件（可能是合并片段或代理）");
                    continue;
                }
            } catch (e1) {}
            item.changeMediaPath(newPath, true);
            var now = "";
            try { now = String(item.getMediaPath()); } catch (e2) {}
            if (vnPathKey(now) !== want) {
                result.errors.push("Premiere 没换成新文件");
                continue;
            }
            if (newName) item.name = newName;
            touched[String(item.nodeId)] = true;
            result.relinked++;
        }
        if (newName && renameClips === "1" && result.relinked > 0) {
            var seqs = app.project.sequences;
            for (var s = 0; s < seqs.numSequences; s++) {
                var tracks = seqs[s].audioTracks;
                for (var t = 0; t < tracks.numTracks; t++) {
                    var clips = tracks[t].clips;
                    for (var c = 0; c < clips.numItems; c++) {
                        var clip = clips[c];
                        try {
                            if (clip.projectItem && touched[String(clip.projectItem.nodeId)]) {
                                clip.name = newName;
                                result.clips++;
                            }
                        } catch (e3) {}
                    }
                }
            }
        }
        if (result.errors.length) result.ok = false;
    } catch (e) {
        result.ok = false;
        result.errors.push(String(e));
    }
    return vnJson(result);
}

// 在项目面板里选中这个素材
function vnSelect(id) {
    try {
        var item = vnFind(id);
        if (!item) return vnJson({ ok: false, error: "找不到素材" });
        if (item.select) item.select();
        return vnJson({ ok: true });
    } catch (e) {
        return vnJson({ ok: false, error: String(e) });
    }
}
