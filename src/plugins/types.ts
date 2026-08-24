import type { playerController } from "../PlayerController";

/** 控制器插件的生命周期接口。 */
export interface PlayerPlugin {
    /** 插件名称；注册同名插件时会替换已有插件。 */
    readonly name?: string;

    /** 注册到控制器后调用。 */
    onAttach?(player: playerController): void;

    /** 从控制器卸载后调用。 */
    onDetach?(): void;

    /** 动画混合器更新前调用，适合恢复上一帧修改。 */
    onBeforeAnimationUpdate?(delta: number): void;

    /** 动画混合器更新后调用，适合应用本帧后处理。 */
    onAfterAnimationUpdate?(delta: number): void;

    /** 玩家模型切换后调用，插件可在此重新绑定资源。 */
    onPlayerModelChange?(): void;

    /** 控制器销毁时调用。 */
    dispose?(): void;
}
