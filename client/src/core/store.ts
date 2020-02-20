import { getModule, Module, Mutation, VuexModule } from "vuex-module-decorators";

import { rootStore } from "@/store";

export interface CoreState {
    authenticated: boolean;
    initialized: boolean;
    username: string;
    email?: string;
}

@Module({ dynamic: true, store: rootStore, name: "core" })
class CoreStore extends VuexModule implements CoreState {
    authenticated = false;
    initialized = false;
    username = "";
    email: string | undefined = undefined;

    @Mutation
    setAuthenticated(auth: boolean): void {
        this.authenticated = auth;
    }

    @Mutation
    setInitialized(init: boolean): void {
        this.initialized = init;
    }

    @Mutation
    setUsername(username: string): void {
        this.username = username;
    }

    @Mutation
    setEmail(email: string): void {
        this.email = email;
    }
}

export const coreStore = getModule(CoreStore);
