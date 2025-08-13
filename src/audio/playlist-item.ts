
export class PlaylistItem {
    public playlistId: string;
    public timestamp: number;
    public user: string;
    public url: string;
    public title: string;
    public description: string;
    public duration: number;
    public uploader: string;
    public itemCount: number;

    constructor(playlistId: string, url: string, title: string, description: string, duration: number, uploader: string, user: string, itemCount: number, timestamp: number | null = null) {
        this.playlistId = playlistId;
        this.url = url;
        this.title = title;
        this.description = description;
        this.duration = duration;
        this.uploader = uploader;
        this.user = user;
        this.timestamp = timestamp || Date.now();
        this.itemCount = itemCount;
    }
}