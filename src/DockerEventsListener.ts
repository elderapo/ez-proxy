import {
  RemoveEventListener,
  TypedEventEmitter
} from "@elderapo/typed-event-emitter";
import { Docker } from "node-docker-api";
import { Stream } from "stream";
import { KeyValueStore } from "./types";

export enum DockerEvent {
  Start,
  Die
}

export interface DockerEvents {
  [DockerEvent.Start]: {
    containerId: string;
    attributes: KeyValueStore;
  };
  [DockerEvent.Die]: {
    containerId: string;
    attributes: KeyValueStore;
  };
}

export class DockerEventsListener {
  private stream: Stream;
  private ee = new TypedEventEmitter<DockerEvents>();

  constructor(private docker: Docker) {
    this.setupEvents();
  }

  public on<Event extends keyof DockerEvents>(
    event: Event,
    listener: (payload: DockerEvents[Event]) => void
  ): RemoveEventListener {
    return this.ee.on(event, listener);
  }

  public once<Event extends keyof DockerEvents>(
    event: Event,
    listener: (payload: DockerEvents[Event]) => void
  ): RemoveEventListener {
    return this.ee.once(event, listener);
  }

  private async setupEvents() {
    const s = await this.docker.events({
      // since: (new Date().getTime() / 1000 - 6000).toFixed(0)
    });

    this.stream = s as any;

    this.stream.on("data", d => this.onRawEventData(d));
    // this.stream.on("end", resolve);
    // this.stream.on("error", reject);
  }

  private onRawEventData(rawData: Buffer) {
    let data = null;

    try {
      data = JSON.parse(rawData.toString());
    } catch (ex) {
      console.log(`Couldn't parse raw event!`);
      return;
    }

    // console.log(data);

    const { status, id: containerId } = data;
    const attributes =
      data && data.Actor && data.Actor.Attributes ? data.Actor.Attributes : {};

    if (status === "start") {
      this.ee.emit(DockerEvent.Start, { containerId, attributes });
    } else if (status === "die") {
      this.ee.emit(DockerEvent.Die, { containerId, attributes });
    }
  }
}
