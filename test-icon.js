const { app } = require("electron");

app.whenReady().then(async () => {
    try {
        const icon1 = await app.getFileIcon("/Applications/Xcode.app", { size: "normal" });
        const icon2 = await app.getFileIcon("/System/Library/CoreServices/Finder.app", { size: "normal" });
        console.log("Xcode icon length:", icon1.toDataURL().length);
        console.log("Xcode png length:", icon1.toPNG().length);
        require("fs").writeFileSync("xcode_test.png", icon1.toPNG());
        console.log("Finder png length:", icon2.toPNG().length);
        require("fs").writeFileSync("finder_test.png", icon2.toPNG());
    } catch (err) {
        console.error(err);
    }
    app.quit();
});
